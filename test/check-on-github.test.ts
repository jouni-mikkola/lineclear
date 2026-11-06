import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { chooseModels, ownEnv, sh, tmp } from "./helpers.ts";

const bin = join(import.meta.dir, "..", "bin", "lineclear");
let root: string;
let repo: string;
let vars: Record<string, string>;
const ran = () => join(root, "full-check-ran");
const calls = () => (existsSync(join(root, "calls")) ? readFileSync(join(root, "calls"), "utf8").trim().split("\n") : []);

/** A server whose `check-where` says `where` and whose `checks` ends as `checks`; every call is logged. */
function fakeServer(where: string, checks: string) {
  const fake = join(root, "lineclear");
  writeFileSync(
    fake,
    `#!/bin/sh
case "$1" in
  check-where|pr|checks) echo "$@" >> ${join(root, "calls")} ;;
  *) printf 'demo  DEM  ${repo}  github:x/y\\n' ;;
esac
case "$1" in
  check-where) echo ${where} ;;
  pr) echo "Pushed to PR #7" ;;
  checks) ${checks} ;;
esac
`,
  );
  chmodSync(fake, 0o755);
}

beforeEach(async () => {
  root = tmp("check-github");
  repo = join(root, "repo");
  mkdirSync(repo);
  sh(["git", "init", "-q", "-b", "main"], { cwd: repo });
  vars = ownEnv(root, { LINECLEAR_CONFIG: join(root, "config"), HOME: root, LINECLEAR_SERVER_BIN: join(root, "lineclear"), LINECLEAR_BIN: bin });
  fakeServer("github", "echo ok");
  chooseModels(join(root, "config"));
  const saved = { ...process.env };
  Object.assign(process.env, vars);
  try {
    await main(
      ["project", "add", repo, "--name", "demo", "--worker", "a", "--reviewer", "b", "--planner", "c", "--check", `touch ${ran()}`, "--heavy", "true"],
      () => {},
      null,
    );
  } finally {
    for (const k of Object.keys(vars)) if (saved[k] === undefined) delete process.env[k];
    Object.assign(process.env, saved);
  }
  writeFileSync(join(root, "config", "machine.json"), JSON.stringify({ loadPerCore: 1e6 }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const agent = () => ({ ...vars, LINECLEAR_TASK: "LIN-1" });

test("where the full check runs on GitHub, an agent's lineclear check hands the branch over and runs no check script", () => {
  fakeServer("github", 'echo "GitHub\'s checks passed on PR #7 (3)."');
  const r = sh([bin, "check"], { cwd: repo, env: agent() });
  expect(r.code).toBe(0);
  expect(r.out).toContain("GitHub's checks passed on PR #7");
  expect(existsSync(ran())).toBe(false);
  expect(calls()).toEqual(["check-where", "pr LIN-1", "checks LIN-1"]);
});

test("a failed GitHub check is reported with its failing tests and a failing code", () => {
  fakeServer("github", 'echo "GitHub\'s checks failed on PR #7: check. Failing tests: a.test.ts > one."; exit 1');
  const r = sh([bin, "check"], { cwd: repo, env: agent() });
  expect(r.code).toBe(1);
  expect(r.out).toContain("Failing tests: a.test.ts > one.");
  expect(existsSync(ran())).toBe(false);
});

test("where the full check runs here, lineclear check still runs the project's check", () => {
  fakeServer("local", "echo ok");
  expect(sh([bin, "check"], { cwd: repo, env: agent() }).code).toBe(0);
  expect(existsSync(ran())).toBe(true);
  expect(calls()).toEqual(["check-where"]);
});
