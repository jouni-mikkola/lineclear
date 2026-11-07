import { expect, test } from "bun:test";
import type { Failure } from "../scripts/failures.ts";
import { judge, type Quarantined, QUARANTINE_MAX } from "../scripts/quarantine.ts";

const f = (n: number): Failure => ({ file: "test/a.test.ts", test: `t${n}` });
const passing = async () => true;

test("a flake that passes alone is quarantined with its task and does not block", async () => {
  const v = await judge([f(1)], [], "LE-9", passing);
  expect(v.blocking).toEqual([]);
  expect(v.tolerated).toEqual([f(1)]);
  expect(v.quarantine).toEqual([{ file: "test/a.test.ts", test: "t1", task: "LE-9" }]);
});

test("a failure that fails alone still blocks, quarantined or not", async () => {
  const known: Quarantined[] = [{ file: "test/a.test.ts", test: "t1", task: "LE-9" }];
  const v = await judge([f(1), f(2)], known, "LE-10", async () => false);
  expect(v.blocking).toEqual([f(1), f(2)]);
  expect(v.quarantine).toEqual(known);
});

test("a 6th flake blocks and the quarantine stays at 5", async () => {
  const full = Array.from({ length: QUARANTINE_MAX }, (_, i) => ({ ...f(i), task: "LE-1" }));
  const v = await judge([f(99), f(0)], full, "LE-2", passing);
  expect(v.blocking).toEqual([f(99)]);
  expect(v.tolerated).toEqual([f(0)]);
  expect(v.quarantine).toHaveLength(QUARANTINE_MAX);
});
