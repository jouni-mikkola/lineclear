import { expect, test } from "bun:test";
import { type Failure, judgeFailures, outsideChange, parseFailures, QUARANTINE_MAX } from "../scripts/failures.ts";

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

const named = (n: number): Failure => ({ file: "test/f.test.ts", test: `t${n}` });

test("a flake joins the quarantine with its task and passes, a break fails, a 6th flake fails", () => {
  const flake = judgeFailures([named(0)], () => false, [], "LE-9");
  expect(flake).toMatchObject({ ok: true, quarantine: [{ test: "test/f.test.ts > t0", task: "LE-9" }] });
  expect(judgeFailures([named(0)], () => true, [], "LE-9").ok).toBe(false);
  expect(judgeFailures([named(0)], () => false, flake.quarantine, "LE-10")).toMatchObject({ ok: true, quarantine: flake.quarantine });
  expect(judgeFailures([named(0)], () => true, flake.quarantine, "LE-10").ok).toBe(false);
  const full = Array.from({ length: QUARANTINE_MAX }, (_, i) => ({ test: `x > ${i}`, task: "LE-1" }));
  const sixth = judgeFailures([named(6)], () => false, full, "LE-11", "server/");
  expect(sixth.ok).toBe(false);
  expect(sixth.quarantine).toHaveLength(QUARANTINE_MAX);
});
