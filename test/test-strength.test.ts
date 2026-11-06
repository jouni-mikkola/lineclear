import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testStrengthFaults } from "../scripts/gates/test-strength.ts";

const diff = (removed: string[], added: string[], file = "test/x.test.ts"): string =>
  [`--- a/${file}`, `+++ b/${file}`, "@@ -3,1 +3,1 @@", ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)].join("\n");
const CAUSE = "Fix x\n\nCause: x test: waited on the socket before it listened, now waits for the listen event\n";

describe("test strength gate", () => {
  test("fails a raised time limit", () => {
    expect(testStrengthFaults(diff(["  await Bun.sleep(100);"], ["  await Bun.sleep(900);"]), ["Fix x"])[0]).toContain("raises a time limit");
    expect(testStrengthFaults(diff(["}, 2000);"], ["}, 9000);"]), ["Fix x"])[0]).toContain("raises a time limit");
  });
  test("fails a new retry", () => {
    expect(testStrengthFaults(diff([], ["  bun test --rerun-each 3"]), ["Fix x"])[0]).toContain("adds a retry");
    expect(testStrengthFaults(diff([], ["  while (tries < 5) {", "    expect(await ready()).toBe(true);"]), ["Fix x"])[0]).toContain("adds a retry");
  });
  test("fails a removed expect", () => {
    expect(testStrengthFaults(diff(["  expect(a).toBe(1);", "  expect(b).toBe(2);"], ["  expect(a).toBe(1);"]), ["Fix x"])[0]).toContain("removes 1 expect");
  });
  test("fails a new skip", () => {
    expect(testStrengthFaults(diff(["test('a', () => {"], ["test.skip('a', () => {"]), ["Fix x"])[0]).toContain("adds a skip");
  });
  test("passes with a cause line", () => {
    expect(testStrengthFaults(diff(["  await Bun.sleep(100);"], ["  await Bun.sleep(900);"]), [CAUSE])).toEqual([]);
  });
  test("passes a lowered limit and a change outside test files", () => {
    expect(testStrengthFaults(diff(["  await Bun.sleep(900);"], ["  await Bun.sleep(100);"]), ["Fix x"])).toEqual([]);
    expect(testStrengthFaults(diff(["  await Bun.sleep(100);"], ["  await Bun.sleep(900);"], "src/x.ts"), ["Fix x"])).toEqual([]);
  });
  test("fails a sleep or limit added from nothing, a deleted test's expects and a toPass", () => {
    expect(testStrengthFaults(diff([], ["  await Bun.sleep(5000);"]), ["Fix x"])[0]).toContain("raises a time limit");
    expect(testStrengthFaults(diff(["});"], ["}, 60_000);"]), ["Fix x"])[0]).toContain("raises a time limit");
    expect(testStrengthFaults(diff([], ["  await expect(async () => {}).toPass();"]), ["Fix x"])[0]).toContain("adds a retry");
    const gone = ["--- a/test/old.test.ts", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-expect(a).toBe(1);", "-expect(b).toBe(1);"].join("\n");
    expect(testStrengthFaults(gone, ["Fix x"])[0]).toContain("test/old.test.ts removes 2 expects");
  });
  test("a cause line clears only the test it names", () => {
    expect(testStrengthFaults(diff([], ["test.skip('a', () => {"]), ["Cause: other thing: waited on it"])).not.toEqual([]);
  });
  test("a cause line needs a test and a reason", () => {
    expect(testStrengthFaults(diff([], ["test.skip('a', () => {"]), ["Cause: nothing"])).not.toEqual([]);
  });
});

const GATES = join(import.meta.dir, "..", "scripts", "gates", "run.ts");
const git = (cwd: string, ...args: string[]): void => {
  const p = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdout: "ignore", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
};

/** A repo with a passing test on main, then a branch commit that rewrites it with `after` and `message`; the gate's exit code. */
function gateOnBranch(after: string, message: string): number {
  const dir = mkdtempSync(join(tmpdir(), "lc-strength-"));
  try {
    git(dir, "init", "-q", "-b", "main");
    mkdirSync(join(dir, "test"));
    writeFileSync(join(dir, "test/x.test.ts"), "test('x', async () => {\n  await Bun.sleep(100);\n  expect(a).toBe(1);\n  expect(b).toBe(2);\n});\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "base");
    git(dir, "checkout", "-q", "-b", "fix");
    writeFileSync(join(dir, "test/x.test.ts"), after);
    git(dir, "commit", "-qam", message);
    return Bun.spawnSync(["bun", GATES, "--root", dir, "test-strength"], { stdout: "ignore", stderr: "ignore" }).exitCode;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const body = (middle: string): string => `test('x', async () => {\n${middle}  expect(a).toBe(1);\n  expect(b).toBe(2);\n});\n`;

describe("test strength gate on a real branch", () => {
  const sleep = body("  await Bun.sleep(900);\n");
  test("fails a raised sleep", () => expect(gateOnBranch(sleep, "Fix x")).toBe(1));
  test("fails a new retry", () => expect(gateOnBranch(body("  await Bun.sleep(100);\n  await retry(() => 1);\n"), "Fix x")).toBe(1));
  test("fails a removed expect", () => expect(gateOnBranch("test('x', async () => {\n  await Bun.sleep(100);\n  expect(a).toBe(1);\n});\n", "Fix x")).toBe(1));
  test("fails a new skip", () =>
    expect(gateOnBranch("test.skip('x', async () => {\n  await Bun.sleep(100);\n  expect(a).toBe(1);\n  expect(b).toBe(2);\n});\n", "Fix x")).toBe(1));
  test("passes with a cause line", () => {
    expect(gateOnBranch(sleep, "Fix x\n\nCause: x: waited on the socket before it listened, now waits for the listen event")).toBe(0);
  });
});
