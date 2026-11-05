import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Probe } from "../src/doctor.ts";
import { findLeftovers, fixLeftovers, leftoverChecks, onMain } from "../src/leftovers.ts";
import { trackMain } from "../src/track.ts";
import { git as sh } from "./fakes.ts";

function machine() {
  const home = mkdtempSync(join(tmpdir(), "leftovers-"));
  const data = join(home, ".lineclear");
  mkdirSync(data, { recursive: true });
  const repo = join(home, "repo");
  mkdirSync(repo);
  sh(repo, "init", "-b", "main");
  sh(repo, "commit", "--allow-empty", "-m", "first");
  const vars = { HOME: home, LINECLEAR_HOME: data };
  const worktree = (name: string, change?: "commit" | "dirty") => {
    const dir = join(home, ".herdr", "worktrees", "repo", `work-${name}`);
    sh(repo, "worktree", "add", "-b", `work/${name}`, dir);
    if (change) writeFileSync(join(dir, `${name}.txt`), "x\n");
    if (change === "commit") {
      sh(dir, "add", ".");
      sh(dir, "commit", "-m", name);
    }
    return dir;
  };
  return { home, data, repo, vars, worktree };
}

const probe = (vars: Record<string, string>): Probe => ({ leftovers: () => findLeftovers(vars) }) as Probe;

test("a merged clean worktree and its branch go; an unmerged, a dirty and an open task's stay", () => {
  const m = machine();
  const merged = m.worktree("merged");
  const unmerged = m.worktree("unmerged", "commit");
  const dirty = m.worktree("dirty", "dirty");
  const open = m.worktree("open");
  writeFileSync(
    join(m.data, "tasks.json"),
    JSON.stringify({
      tasks: [
        { worktree: open, branch: "work/open" },
        { worktree: merged, branch: "work/merged", merged: true },
      ],
    }),
  );
  const found = findLeftovers(m.vars);
  expect(found.removable.map((r) => `${r.kind} ${r.path}`)).toEqual([`worktree ${merged}`]);
  expect(found.kept.map((k) => k.what).sort()).toEqual([dirty, unmerged].sort());
  expect(found.kept.find((k) => k.what === dirty)?.why).toBe("uncommitted or ignored files");

  const lines: string[] = [];
  expect(fixLeftovers(probe(m.vars), (l) => lines.push(l))).toBe(0);
  expect(existsSync(merged)).toBe(false);
  expect(Bun.spawnSync(["git", "-C", m.repo, "branch", "--list", "work/merged"]).stdout.toString()).toBe("");
  for (const kept of [unmerged, dirty, open]) expect(existsSync(kept)).toBe(true);
  expect(lines.some((l) => l.startsWith("Removed worktree"))).toBe(true);
  expect(lines.filter((l) => l.startsWith("Kept")).length).toBe(2);
});

test("a branch whose commits are on main by a squash merge counts as landed", () => {
  const m = machine();
  const dir = m.worktree("squashed", "commit");
  sh(m.repo, "merge", "--squash", "work/squashed");
  sh(m.repo, "commit", "-m", "squash");
  expect(onMain(m.repo, "work/squashed")).toBe(true);
  expect(findLeftovers(m.vars).removable.map((r) => r.path)).toEqual([dir]);
});

test("a local branch on main with no worktree is a leftover, one with commits main lacks is kept", () => {
  const m = machine();
  m.worktree("seed");
  sh(m.repo, "branch", "work/gone");
  sh(m.repo, "branch", "work/ahead");
  const tmp = join(m.home, "tmp-ahead");
  sh(m.repo, "worktree", "add", tmp, "work/ahead");
  writeFileSync(join(tmp, "b.txt"), "b");
  sh(tmp, "add", ".");
  sh(tmp, "commit", "-m", "ahead");
  sh(m.repo, "worktree", "remove", tmp);
  const found = findLeftovers(m.vars);
  expect(found.removable.filter((r) => r.kind === "branch").map((r) => r.path)).toEqual(["work/gone"]);
  expect(found.kept.map((k) => k.what)).toContain("branch work/ahead");
});

test("a folder git no longer knows goes only when it holds nothing but node_modules", () => {
  const m = machine();
  const root = join(m.home, ".herdr", "worktrees", "repo");
  mkdirSync(join(root, "old", "server", "node_modules", ".cache"), { recursive: true });
  mkdirSync(join(root, "real"), { recursive: true });
  writeFileSync(join(root, "real", "notes.md"), "mine");
  const found = findLeftovers(m.vars);
  expect(found.removable.map((r) => `${r.kind} ${r.path}`)).toEqual([`folder ${join(root, "old")}`]);
  expect(found.kept.map((k) => k.what)).toEqual([join(root, "real")]);
});

test("autopilot runtime: a finished run loses all but its captures, a live run keeps everything", () => {
  const m = machine();
  const lay = (run: string) => {
    const key = join(m.data, "autopilot-runtime", run, "LINE-1_Agent");
    for (const d of ["captures", "home", "launcher"]) mkdirSync(join(key, d), { recursive: true });
    writeFileSync(join(key, "home", "big"), "x".repeat(2000));
    return key;
  };
  const done = lay("run-done");
  const live = lay("run-live");
  writeFileSync(
    join(m.data, "autopilot-runs.json"),
    JSON.stringify([
      { id: "run-done", state: "stopped" },
      { id: "run-live", state: "on" },
    ]),
  );
  const found = findLeftovers(m.vars);
  expect(found.removable.map((r) => r.path).sort()).toEqual([join(done, "home"), join(done, "launcher")]);
  fixLeftovers(probe(m.vars), () => undefined);
  expect(existsSync(join(done, "captures"))).toBe(true);
  expect(existsSync(join(done, "home"))).toBe(false);
  expect(existsSync(join(live, "home"))).toBe(true);
});

test("doctor lists each kind with its count and size, and an ok check names what is kept", () => {
  const m = machine();
  m.worktree("merged");
  m.worktree("dirty", "dirty");
  const checks = leftoverChecks(probe(m.vars));
  const wt = checks.find((c) => c.name === "leftover worktrees of finished tasks");
  expect(wt?.problem).toMatch(/^1 \(\d+ MB\)/);
  expect(wt?.fix).toBe("lineclear doctor --fix");
  expect(checks.find((c) => c.name === "leftover coordinator timer folders of finished runs")?.problem).toBe("");
  expect(checks.find((c) => c.name === "leftovers kept")?.info).toContain("uncommitted or ignored files");
});

test("the test track skips, and does not fail its unit, where no project is Lineclear's own", async () => {
  const m = machine();
  const lines: string[] = [];
  const vars = { ...m.vars, LINECLEAR_CONFIG: join(m.home, "config"), XDG_DATA_HOME: join(m.home, "share"), PI_CODING_AGENT_DIR: join(m.home, "pi") };
  expect(await trackMain([], (l) => lines.push(l), vars)).toBe(0);
  expect(lines.join("\n")).toContain("no project is Lineclear's own");
});

test("a detached worktree with commits main lacks, and one with ignored files, are kept", () => {
  const m = machine();
  const det = m.worktree("det");
  sh(det, "checkout", "--detach");
  writeFileSync(join(det, "c.txt"), "c");
  sh(det, "add", ".");
  sh(det, "commit", "-m", "only here");
  const ign = m.worktree("ign");
  writeFileSync(join(m.repo, ".gitignore"), ".env\n");
  sh(m.repo, "add", ".");
  sh(m.repo, "commit", "-m", "ignore");
  writeFileSync(join(ign, ".env"), "secret");
  const found = findLeftovers(m.vars);
  expect(found.kept.map((k) => k.what).sort()).toEqual([det, ign].sort());
});

test("without the runs record no runtime folder is touched", () => {
  const m = machine();
  mkdirSync(join(m.data, "autopilot-runtime", "r", "k", "home"), { recursive: true });
  expect(findLeftovers(m.vars).removable).toEqual([]);
});
