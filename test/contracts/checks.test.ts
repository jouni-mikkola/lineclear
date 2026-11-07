// The contract of the check tiers and of where a task's work runs.
import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { changeSettings } from "../../src/project-change.ts";
import { proposeTiers, readSettings, type Settings, tiersOf } from "../../src/project.ts";
import { checkSteps } from "../../src/stepcheck.ts";
import { machineOf, readWork } from "../../src/task-work.ts";
import { sh, tmp } from "../helpers.ts";

function project(scripts: Record<string, string> = { check: "bun test", "types:fast": "tsc", coverage: "bun test --coverage" }) {
  const root = tmp("checks");
  const repo = join(root, "repo");
  mkdirSync(repo);
  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts }));
  sh(["git", "init", "-q", "-b", "main", repo]);
  const config = join(root, "config");
  mkdirSync(join(config, "projects", "app"), { recursive: true });
  writeFileSync(
    join(config, "projects", "app", "settings.json"),
    JSON.stringify({ repo, space: "app", check: "bun run check", models: { worker: [], reviewer: [] } }),
  );
  const env = { ...process.env, LINECLEAR_CONFIG: config };
  const settings = () => readSettings("app", env) as Settings;
  return { repo, env, settings };
}

test("proposeTiers puts fast scripts in inner, the check in merge and heavy ones in heavy", () => {
  const p = project();
  expect(proposeTiers(p.repo, "bun run check")).toEqual({
    inner: { commands: ["bun run types:fast"], budgetS: 30 },
    merge: { commands: ["bun run check"], budgetS: 180 },
    heavy: { commands: ["bun run coverage"], budgetS: 3600 },
  });
});

test("tiers the owner did not set follow the check: a changed check is the merge tier", () => {
  const p = project();
  expect(changeSettings("app", { tiers: { inner: { commands: ["bun run types:fast"] } } }, p.env)).not.toBeString();
  expect(changeSettings("app", { check: "make check" }, p.env)).not.toBeString();
  expect(p.settings().tiers).toEqual({ inner: { commands: ["bun run types:fast"] } });
  expect(tiersOf(p.settings()).merge.commands).toEqual(["make check"]);
  expect(changeSettings("app", { tiers: { merge: { commands: [] } } }, p.env)).toBe("the merge tier needs a command");
});

test("a task on machine B has its step check run on B, none on the main machine", () => {
  const p = project();
  const env = { ...p.env, LINECLEAR_MACHINE: "boxb.local" };
  const pi = join(p.repo, "..", "pi");
  writeFileSync(pi, "#!/bin/sh\nprintf 'SAID: fine\\nGO\\n'\n");
  chmodSync(pi, 0o755);
  const after = "## P\n\n### A Title\n- why: because\n- done when:\n  - it works\n- locks: none\n- after: none\n- files: src/a.ts\n";
  const verdict = checkSteps({
    task: "LIN-7",
    root: p.repo,
    before: "## P\n\n",
    after,
    planner: undefined,
    reviewers: ["openai/gpt-5"],
    env: { ...env, PI_BIN: pi },
  });
  expect(verdict.kind).toBe("go");
  const work = readWork(env);
  expect(work.map((w) => w.work).sort()).toEqual(["stepcheck"]);
  expect(work.every((w) => w.machine === "boxb")).toBe(true);
  expect(work.some((w) => w.machine === machineOf(p.env))).toBe(false);
});
