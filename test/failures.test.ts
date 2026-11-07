import { expect, test } from "bun:test";
import { type Failure, judge, outsideChange, parseFailures, QUARANTINE_MAX, type Quarantined } from "../scripts/failures.ts";

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

const flake = (n: number): Failure => ({ file: "test/f.test.ts", test: `flake ${n}` });
const held = (n: number): Quarantined => ({ ...flake(n), fix: "LIN-1" });

test("a test that fails and then passes alone is quarantined, one that fails alone too is not", () => {
  const verdict = judge([flake(1), b], [], (f) => f !== b);
  expect(verdict.flaky).toEqual([flake(1)]);
  expect(verdict.broken).toEqual([b]);
  expect(verdict.next).toEqual([{ ...flake(1), fix: "unfiled" }]);
});

test("a quarantined test's failure alone does not fail, its failure alone too still does", () => {
  expect(judge([flake(1)], [held(1)], () => true).broken).toEqual([]);
  expect(judge([flake(1)], [held(1)], () => false).broken).toEqual([flake(1)]);
});

test("the sixth flake is refused and the quarantine stays as it was", () => {
  const five = Array.from({ length: QUARANTINE_MAX }, (_, i) => held(i));
  const verdict = judge([flake(9)], five, () => true);
  expect(verdict.broken).toEqual([flake(9)]);
  expect(verdict.next).toEqual(five);
  expect(verdict.error).toContain("full");
});
