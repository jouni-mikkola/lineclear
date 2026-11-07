import { expect, test } from "bun:test";
import { type Failure, outsideChange, parseFailures } from "../scripts/failures.ts";

const a: Failure = { file: "test/a.test.ts", test: "a (slow) one" };
const b: Failure = { file: "test/b.test.ts", test: "b" };

test("failures are read with their file, and the summary's repeat is left out", () => {
  const out = [
    "bun test",
    "test/a.test.ts:",
    "(pass) ok [1ms]",
    "(fail) a (slow) one [5.5ms]",
    "test/b.test.ts:",
    "(fail) b [2ms]",
    "",
    "2 tests failed:",
    "(fail) a (slow) one [5.5ms]",
  ].join("\n");
  expect(parseFailures(out)).toEqual([a, b]);
});

test("a failure outside the files the change reaches is the machine's: only then a shard runs again", () => {
  const touched = new Set(["test/b.test.ts"]);
  expect(outsideChange([a], touched)).toBe(true);
  expect(outsideChange([{ ...a, file: "./test/a.test.ts" }], touched)).toBe(true);
  expect(outsideChange([a, b], touched)).toBe(false);
  expect(outsideChange([], touched)).toBe(false);
  expect(outsideChange([{ file: "", test: "x" }], touched)).toBe(false);
});

const flake = (n: number): Failure => ({ file: "server/test/f.test.ts", test: `flake ${n}` });
const listed = (n: number) => ({ file: "server/test/f.test.ts", test: `flake ${n}`, task: `LE-${n}` });

test("a quarantined flake alone does not fail, a break does, a 6th flake does", async () => {
  const { judgeFailures, passes, MAX_QUARANTINE, readQuarantine } = await import("../scripts/failures.ts");
  const quarantine = [1, 2, 3, 4].map(listed);
  // planted flake: failed, passed alone, listed
  expect(passes(judgeFailures([flake(1)], [], quarantine))).toBe(true);
  // planted break: failed alone too
  expect(passes(judgeFailures([flake(1), b], [b], quarantine))).toBe(false);
  // a flake not yet listed fails until it is added; with 5 listed a 6th has no room
  expect(passes(judgeFailures([flake(5)], [], quarantine))).toBe(false);
  expect(passes(judgeFailures([flake(5)], [], quarantine.slice(0, 3)))).toBe(false);
  const five = [1, 2, 3, 4, 5].map(listed);
  const sixth = judgeFailures([flake(6)], [], five);
  expect(sixth.full).toBe(true);
  expect(passes(sixth)).toBe(false);
  expect(MAX_QUARANTINE).toBe(5);
  expect(readQuarantine("test/quarantine.json").length).toBeLessThanOrEqual(MAX_QUARANTINE);
});

test("a failed test is rerun alone by its file and name", async () => {
  const { aloneCommand } = await import("../scripts/failures.ts");
  expect(aloneCommand({ file: "test/a.test.ts", test: "group > does (x)" }).slice(-3)).toEqual(["./test/a.test.ts", "-t", "does \\(x\\)"]);
});
