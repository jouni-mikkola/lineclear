import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { roadmapMain } from "../src/roadmap-cli.ts";

process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "t";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "t@t";

const temps: string[] = [];
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

const dir = () => {
  const d = mkdtempSync(join(tmpdir(), "lc-import-"));
  temps.push(d);
  return d;
};

const step = (id: string, state: string, after: string[], extra: object = {}) => ({
  id,
  title: `Title ${id}`,
  phase: id < "C" ? "Phase 0: Base" : "Phase 1: More",
  state,
  result: `Title ${id} works.`,
  why: "because",
  done_when: ["it works", "it is fast"],
  locks: "repo",
  after,
  ...extra,
});

function repo(): string {
  const d = dir();
  const git = (...a: string[]) => Bun.spawnSync(["git", "-C", d, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
  git("init", "-q");
  git("config", "user.name", "t");
  git("config", "user.email", "t@t");
  git("commit", "-q", "--allow-empty", "-m", "start");
  return d;
}

function importInto(r: string, steps: unknown, ...flags: string[]) {
  const f = join(dir(), "plan.json");
  writeFileSync(f, JSON.stringify(steps));
  const out: string[] = [];
  const code = roadmapMain(["import", f, r, ...flags], (l) => out.push(l));
  return { code, out };
}

test("a field it cannot place stops the import and writes nothing", () => {
  const cases: [unknown, string][] = [
    [[step("A", "maybe", ["none"])], "step A, field state"],
    [[step("A", "open", ["none"], { colour: "red" })], "step A, field colour: unknown field"],
    [[step("A", "open", ["none"], { why: "two\nlines" })], "step A, field why"],
    [[step("A", "open", ["none"], { locks: undefined })], "step A, field locks"],
    [[step("A", "open", ["none"], { reason: "x" })], "step A, field reason"],
    [[step("A", "open", ["none"]), step("A", "open", ["none"])], "step A, field id: used twice"],
    [[step("A", "open", ["Z"])], "unknown 'after' id Z"],
    [[step("A", "open", ["B"]), step("B", "open", ["A"])], "circular"],
  ];
  for (const [steps, message] of cases) {
    const r = repo();
    const { code, out } = importInto(r, steps);
    expect(code).toBe(1);
    expect(out.join("\n")).toContain(message);
    expect(existsSync(join(r, "docs", "ROADMAP.md"))).toBe(false);
  }
});

test("one bad field among good steps stops everything: the error names step and field, no file, no commit", () => {
  const r = repo();
  const head = () => Bun.spawnSync(["git", "-C", r, "rev-parse", "HEAD"]).stdout.toString();
  const before = head();
  const steps = [step("A", "done", ["none"]), step("B", "open", ["A"], { locks: undefined }), step("C", "dropped", ["none"])];
  const { code, out } = importInto(r, steps);
  expect(code).toBe(1);
  expect(out.join("\n")).toMatch(/step B, field locks: /);
  expect(out.join("\n")).not.toContain("step A,");
  expect(existsSync(join(r, "docs", "ROADMAP.md"))).toBe(false);
  expect(head()).toBe(before);
  expect(Bun.spawnSync(["git", "-C", r, "status", "--porcelain"]).stdout.toString()).toBe("");
});

test("every state imports, checks, and done survives in the commit", () => {
  const r = repo();
  const { code } = importInto(r, [
    step("A", "done", ["none"]),
    step("B", "open", ["A"]),
    step("C", "dropped", ["A"]),
    step("D", "dropped", ["B"], { reason: "not wanted" }),
    step("E", "done", ["B", "C"]),
  ]);
  expect(code).toBe(0);
  const text = readFileSync(join(r, "docs", "ROADMAP.md"), "utf8");
  expect(text).toContain("## Phase 0: Base");
  expect(text).toContain("- dropped: imported as dropped");
  expect(text).toContain("- dropped: not wanted");
  expect(text).toContain("- done when:\n  - it works\n  - it is fast");
  expect(roadmapMain(["check", r], () => {})).toBe(0);

  const body = Bun.spawnSync(["git", "-C", r, "log", "-1", "--format=%B"]).stdout.toString();
  expect(body.split("\n").filter((l) => l.startsWith("Step: "))).toEqual(["Step: A", "Step: E"]);

  Bun.spawnSync(["git", "-C", r, "update-ref", "refs/remotes/origin/main", "HEAD"]);
  const out: string[] = [];
  expect(
    roadmapMain(
      ["status", r, "--space", "s", "--json"],
      (l) => out.push(l),
      () => [],
    ),
  ).toBe(0);
  const states = Object.fromEntries((JSON.parse(out.join("\n")) as { id: string; state: string }[]).map((s) => [s.id, s.state]));
  expect(states).toEqual({ A: "done", B: "ready", C: "dropped", D: "dropped", E: "done" });
});

test("a string done_when and an object with steps work", () => {
  const r = repo();
  const s = step("A", "open", ["none"], { done_when: "one thing" });
  expect(importInto(r, { steps: [s] }).code).toBe(0);
  expect(readFileSync(join(r, "docs", "ROADMAP.md"), "utf8")).toContain("  - one thing");
});

test("it will not replace a roadmap without --force, and --no-commit prints the message", () => {
  const r = repo();
  const steps = [step("A", "done", ["none"])];
  expect(importInto(r, steps, "--no-commit").out.join("\n")).toContain("Step: A");
  expect(importInto(r, steps, "--no-commit").code).toBe(1);
  expect(importInto(r, steps, "--no-commit", "--force").code).toBe(0);
  const log = Bun.spawnSync(["git", "-C", r, "log", "--format=%B"]).stdout.toString();
  expect(log).not.toContain("Step: A");
});

test("the example in docs/import.md imports", () => {
  const md = readFileSync(join(import.meta.dir, "..", "docs", "import.md"), "utf8");
  const json = /```json\n([\s\S]*?)```/.exec(md)?.[1] as string;
  expect(importInto(repo(), JSON.parse(json)).code).toBe(0);
});

test("a missing repo is refused, and a failed commit leaves nothing written", () => {
  const steps = [step("A", "done", ["none"])];
  const missing = importInto(join(dir(), "typo"), steps);
  expect(missing.code).toBe(1);
  expect(missing.out.join("\n")).toContain("no such folder");

  const r = repo();
  const hook = join(r, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const { code, out } = importInto(r, steps);
  expect(code).toBe(1);
  expect(out.join("\n")).toContain("commit failed");
  expect(existsSync(join(r, "docs", "ROADMAP.md"))).toBe(false);
  expect(Bun.spawnSync(["git", "-C", r, "status", "--porcelain"]).stdout.toString()).toBe("");
});
