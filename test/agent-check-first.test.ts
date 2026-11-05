import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { removeFolders } from "../src/tmpdirs.ts";
import { lineOf } from "../src/waits.ts";
import { chooseModels, ownEnv, sh, tmp, until } from "./helpers.ts";

const bin = join(import.meta.dir, "..", "bin", "lineclear");
let root: string;
let repo: string;
let vars: Record<string, string>;

beforeEach(async () => {
  root = tmp("agent-first");
  repo = join(root, "repo");
  mkdirSync(repo);
  sh(["git", "init", "-q", "-b", "main"], { cwd: repo });
  const fake = join(root, "shepherdr");
  writeFileSync(fake, `#!/bin/sh\nprintf 'demo  DEM  ${repo}  github:x/y\\n'\n`);
  chmodSync(fake, 0o755);
  vars = ownEnv(root, { LINECLEAR_CONFIG: join(root, "config"), HOME: root, SHEPHERDR_BIN: fake, LINECLEAR_BIN: bin });
  chooseModels(join(root, "config"));
  const saved = { ...process.env };
  Object.assign(process.env, vars);
  try {
    await main(
      ["project", "add", repo, "--name", "demo", "--worker", "a", "--reviewer", "b", "--planner", "c", "--check", "true", "--heavy", "true"],
      () => {},
      null,
    );
  } finally {
    // later test files of this process must not see this test's folders
    for (const k of Object.keys(vars)) if (saved[k] === undefined) delete process.env[k];
    Object.assign(process.env, saved);
  }
  writeFileSync(join(root, "config", "machine.json"), JSON.stringify({ loadPerCore: 1e6 }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const running = (pattern: string) => Bun.spawnSync(["pgrep", "-f", pattern]).exitCode === 0;

test("an agent's check is refused while the merge lane is in the line, and runs without one", () => {
  const line = join(root, "config", "check-queue", lineOf(repo, vars));
  mkdirSync(line, { recursive: true });
  const lane = join(line, "000000000000001-lane.json");
  writeFileSync(lane, JSON.stringify({ pid: process.pid, who: "LIN-9", since: 1, lane: true }));
  const agent = { ...vars, LINECLEAR_TASK: "LIN-1" };
  const refused = sh([bin, "check", "true"], { cwd: repo, env: agent });
  expect(refused.code).toBe(1);
  expect(refused.out).toContain("the merge lane runs the check; run the tests you changed");
  rmSync(lane);
  expect(sh([bin, "check", "true"], { cwd: repo, env: agent }).code).toBe(0);
});

test("a check ends what it started: a straggler left behind when the command ends is killed", () => {
  const p = sh([bin, "slot", "sleep 4551 & true"], { cwd: repo, env: vars });
  expect(p.code).toBe(0);
  expect(running("^sleep 455[1]$")).toBe(false);
});

test("a check whose parent is killed (SIGKILL, no handler runs) takes its whole group down", async () => {
  const check = Bun.spawn([bin, "slot", "sleep 4552 & sleep 4553"], { cwd: repo, env: vars, stdout: "ignore", stderr: "ignore" });
  await until(() => running("^sleep 455[2]$") && running("^sleep 455[3]$"));
  process.kill(check.pid, "SIGKILL");
  await until(() => !running("^sleep 455[23]$"), 100);
  expect(running("^sleep 455[23]$")).toBe(false);
});

test("the temp-folder guard names a process left running from a test's folder, and ends it", async () => {
  const dir = join(root, "scope");
  mkdirSync(dir);
  const left = Bun.spawn(["sleep", "4554"], { cwd: dir, stdout: "ignore" });
  expect(removeFolders([dir])).toEqual([left.pid]);
  await left.exited;
  expect(removeFolders([dir])).toEqual([]);
});

test("the refusal reaches an agent named by its chat", () => {
  const line = join(root, "config", "check-queue", lineOf(repo, vars));
  mkdirSync(line, { recursive: true });
  writeFileSync(join(line, "000000000000001-lane.json"), JSON.stringify({ pid: process.pid, who: "LIN-9", since: 1, lane: true }));
  expect(sh([bin, "check", "true"], { cwd: repo, env: { ...vars, LINECLEAR_CHAT: "LIN-1/Agent" } }).code).toBe(1);
});
