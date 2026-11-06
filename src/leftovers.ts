import { existsSync, readdirSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readJson } from "../pi/config.ts";
import type { Check, Probe } from "./doctor.ts";
import { dataDir } from "./paths.ts";

import { TMP_STALL_BYTES } from "./tmpdirs.ts";
import { git } from "./git.ts";

type Env = Record<string, string | undefined>;

type LeftoverKind = "worktree" | "branch" | "folder" | "autopilot runtime" | "screenshots";

interface Leftover {
  kind: LeftoverKind;
  /** The folder to remove; for a branch, its name. */
  path: string;
  /** The repo a worktree or branch belongs to. */
  repo?: string;
  bytes: number;
}

interface Kept {
  what: string;
  why: string;
}

export interface Leftovers {
  removable: Leftover[];
  kept: Kept[];
}

const MAIN = ["main", "master"];
/** The runs whose folders the board still reads live. */
const LIVE_RUN = new Set(["starting", "on", "stopping", "workers"]);

function sizeOf(path: string): number {
  const r = Bun.spawnSync(["du", "-sk", path], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  return (Number.parseInt(r.stdout.toString(), 10) || 0) * 1024;
}

const dirs = (path: string): string[] => {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(path, e.name));
  } catch {
    return [];
  }
};

/** The folders some process runs in now: an agent at work in a worktree, whichever board started it. */
function busyFolders(): string[] {
  const found: string[] = [];
  for (const pid of readdirSync("/proc").filter((n) => /^\d+$/.test(n))) {
    try {
      found.push(readlinkSync(`/proc/${pid}/cwd`));
    } catch {
      // gone, or not ours to read
    }
  }
  return found;
}

interface OpenWork {
  paths: Set<string>;
  branches: Set<string>;
  busy: string[];
}

/** The worktrees and branches of tasks that are not merged or closed: nothing of them is a leftover. */
function openWork(env: Env): OpenWork {
  const store = readJson(join(dataDir(env), "tasks.json")) as
    | { tasks?: { worktree?: string; branch?: string; merged?: unknown; closed?: unknown }[] }
    | undefined;
  const open: OpenWork = { paths: new Set(), branches: new Set(), busy: busyFolders() };
  for (const t of store?.tasks ?? []) {
    if (t.merged || t.closed) continue;
    if (t.worktree) open.paths.add(resolve(t.worktree));
    if (t.branch) open.branches.add(t.branch);
  }
  return open;
}

/** The commits of `branch` are on main: merged, every one a copy there (git cherry), or its changes already in main (a squash merge). */
export function onMain(repo: string, branch: string): boolean {
  const main = MAIN.find((m) => git(repo, "rev-parse", "--verify", "--quiet", m).ok);
  if (!main) return false;
  if (git(repo, "merge-base", "--is-ancestor", branch, main).ok) return true;
  const cherry = git(repo, "cherry", main, branch);
  if (cherry.ok && !cherry.out.split("\n").some((l) => l.startsWith("+"))) return true;
  const merged = git(repo, "merge-tree", "--write-tree", main, branch);
  return merged.ok && merged.out.split("\n")[0] === git(repo, "rev-parse", `${main}^{tree}`).out.trim();
}

/** A folder git no longer knows holds only what a build left (node_modules and the like), never a file of the user's. */
function onlyBuildLeft(path: string): boolean {
  try {
    return readdirSync(path, { withFileTypes: true }).every((e) => e.name === "node_modules" || (e.isDirectory() && onlyBuildLeft(join(path, e.name))));
  } catch {
    return false;
  }
}

function worktreeLeftover(dir: string, open: OpenWork, found: Leftovers, repos: Set<string>): void {
  if (open.paths.has(resolve(dir)) || open.busy.some((b) => [dir, realpathSync(dir)].some((d) => b === d || b.startsWith(`${d}/`)))) return;
  if (!existsSync(join(dir, ".git"))) {
    if (onlyBuildLeft(dir)) found.removable.push({ kind: "folder", path: dir, bytes: sizeOf(dir) });
    else found.kept.push({ what: dir, why: "not a worktree, and it holds files" });
    return;
  }
  const common = git(dir, "rev-parse", "--path-format=absolute", "--git-common-dir").out.trim();
  const repo = common ? dirname(common) : "";
  const branch = git(dir, "branch", "--show-current").out.trim();
  if (!repo || (branch && open.branches.has(branch))) return;
  repos.add(repo);
  // ignored files go with the folder: only node_modules (made again by an install) may be among them
  const changes = git(dir, "status", "--porcelain", "--ignored")
    .out.split("\n")
    .filter((l) => l && !/^!! (.*\/)?node_modules\/$/.test(l));
  if (changes.length) found.kept.push({ what: dir, why: "uncommitted or ignored files" });
  else if (!onMain(repo, branch || git(dir, "rev-parse", "HEAD").out.trim()))
    found.kept.push({ what: dir, why: `commits of ${branch || "its detached head"} that main lacks` });
  else found.removable.push({ kind: "worktree", path: dir, repo, bytes: sizeOf(dir) });
}

/** Local work/ branches that are on main and checked out nowhere. */
function branchLeftovers(repo: string, open: OpenWork, found: Leftovers): void {
  const out = git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/work/").out.trim();
  const checkedOut = new Set(
    git(repo, "worktree", "list", "--porcelain")
      .out.split("\n")
      .filter((l) => l.startsWith("branch "))
      .map((l) => l.slice("branch refs/heads/".length)),
  );
  for (const branch of out.split("\n").filter(Boolean)) {
    if (open.branches.has(branch) || checkedOut.has(branch)) continue;
    if (onMain(repo, branch)) found.removable.push({ kind: "branch", path: branch, repo, bytes: 0 });
    else found.kept.push({ what: `branch ${branch}`, why: "commits that main lacks" });
  }
}

/** Run folders of finished runs keep their captures (the usage and transcripts the board still reads) and lose the rest. */
function runtimeLeftovers(env: Env, found: Leftovers): void {
  const root = join(dataDir(env), "autopilot-runtime");
  const runs = readJson(join(dataDir(env), "autopilot-runs.json")) as { id: string; state: string }[] | undefined;
  // without the record nothing says which runs are finished
  if (!Array.isArray(runs)) return;
  const finished = new Set(runs.filter((r) => !LIVE_RUN.has(r.state)).map((r) => r.id));
  for (const run of dirs(root)) {
    if (!finished.has(run.slice(root.length + 1))) continue;
    for (const key of dirs(run)) {
      for (const part of readdirSync(key).filter((n) => n !== "captures")) {
        const path = join(key, part);
        found.removable.push({ kind: "autopilot runtime", path, bytes: sizeOf(path) });
      }
    }
  }
}

/** What finished work left on this machine, and what is kept because it holds something (no uncommitted change, no open task). */
export function findLeftovers(env: Env = process.env): Leftovers {
  const found: Leftovers = { removable: [], kept: [] };
  const open = openWork(env);
  const repos = new Set<string>();
  for (const space of dirs(join(env.HOME ?? homedir(), ".herdr", "worktrees"))) {
    for (const dir of dirs(space)) worktreeLeftover(dir, open, found, repos);
  }
  for (const repo of repos) branchLeftovers(repo, open, found);
  runtimeLeftovers(env, found);
  const shots = join(dataDir(env), "ui-shots");
  if (existsSync(shots)) found.removable.push({ kind: "screenshots", path: shots, bytes: sizeOf(shots) });
  return found;
}

/** Removes one leftover; throws why when it cannot (a worktree git refuses to remove stays). */
function removeLeftover(item: Leftover): void {
  if (item.kind === "branch" || item.kind === "worktree") {
    const repo = item.repo;
    if (!repo) throw new Error("its repo is unknown");
    const branch = item.kind === "branch" ? item.path : git(item.path, "branch", "--show-current").out.trim();
    if (item.kind === "worktree") {
      const r = git(repo, "worktree", "remove", item.path);
      if (!r.ok) throw new Error(r.err.split("\n")[0] || "git could not remove it");
      git(repo, "worktree", "prune");
    }
    if (branch && !MAIN.includes(branch) && !git(repo, "branch", "-D", branch).ok) throw new Error(`branch ${branch} stays`);
    return;
  }
  rmSync(item.path, { recursive: true, force: true });
}

const gb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`);

const NAMES: Record<LeftoverKind, string> = {
  worktree: "worktrees of finished tasks",
  branch: "local branches already on main",
  folder: "worktree folders git no longer knows",
  "autopilot runtime": "coordinator timer folders of finished runs",
  screenshots: "update screenshot folders (nothing reads them)",
};

/** One check per kind of leftover with its count and size; what is kept for holding work is told on the line of an ok check. */
export function leftoverChecks(p: Probe): Check[] {
  const found = p.leftovers?.();
  if (!found) return [];
  const checks: Check[] = (Object.keys(NAMES) as LeftoverKind[]).map((kind) => {
    const mine = found.removable.filter((r) => r.kind === kind);
    const total = mine.reduce((n, r) => n + r.bytes, 0);
    return {
      name: `leftover ${NAMES[kind]}`,
      problem: mine.length
        ? `${mine.length} (${gb(total)}): ${mine
            .slice(0, 3)
            .map((r) => r.path)
            .join(", ")}${mine.length > 3 ? ", ..." : ""}`
        : "",
      fix: "lineclear doctor --fix",
    };
  });
  if (found.kept.length) {
    checks.push({ name: "leftovers kept", problem: "", fix: "", info: found.kept.map((k) => `${k.what} (${k.why})`).join("; ") });
  }
  return checks;
}

/** doctor --fix: removes every safe leftover, printing what went and what stays. Returns 1 when one stays. */
export function fixLeftovers(p: Probe, out: (line: string) => void): number {
  const found = p.leftovers?.();
  if (!found) return 0;
  let code = 0;
  // worktrees first: a branch can only go once its folder has
  const order: LeftoverKind[] = ["worktree", "folder", "branch", "autopilot runtime", "screenshots"];
  for (const item of [...found.removable].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) {
    try {
      removeLeftover(item);
      out(`Removed ${item.kind} ${item.path} (${gb(item.bytes)})`);
    } catch (e) {
      out(`Kept ${item.kind} ${item.path}: ${e instanceof Error ? e.message : e}`);
      code = 1;
    }
  }
  for (const k of found.kept) out(`Kept ${k.what}: ${k.why}`);
  return code;
}

/** Folders that tests left in the temp folder can fill it (inodes too) and make later runs fail. */
export function oldTests(p: Probe): Check {
  const n = p.oldTestFolders?.length ?? 0;
  return {
    name: "old test folders",
    problem: n === 0 ? "" : `${n} test folder${n === 1 ? "" : "s"} older than 6 hours that no process uses, in the temp folder`,
    fix: "lineclear doctor --fix",
  };
}

/** A RAM-backed /tmp that fills up pushes the machine into swap, and every task slows: a stall class. */
export function tmpFull(p: Probe): Check {
  const used = p.tmpRamBytes ?? 0;
  return {
    name: "temp folder size",
    problem:
      used > TMP_STALL_BYTES
        ? `/tmp holds ${(used / 1024 ** 3).toFixed(1)} GB in RAM (over ${TMP_STALL_BYTES / 1024 ** 3} GB), so the machine may swap and stall`
        : "",
    fix: "lineclear doctor --fix, then look at what is left: du -sh /tmp/* | sort -h | tail",
  };
}
