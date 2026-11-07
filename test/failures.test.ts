import { expect, test } from "bun:test";
import { type Failure, outsideChange, parseFailures } from "../scripts/failures.ts";
import { failedOutside } from "../src/check-runs.ts";

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

test("the tests the check names as outside the change are read from its output", () => {
  expect(failedOutside("x\ncheck: outside the change: a (slow) one\ncheck: outside the change: b\ncheck: tests 1/4 failed")).toEqual(["a (slow) one", "b"]);
});
