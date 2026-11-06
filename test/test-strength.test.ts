import { describe, expect, test } from "bun:test";
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
  test("a cause line needs a test and a reason", () => {
    expect(testStrengthFaults(diff([], ["test.skip('a', () => {"]), ["Cause: nothing"])).not.toEqual([]);
  });
});
