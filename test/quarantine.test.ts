import { expect, test } from "bun:test";
import type { Failure } from "../scripts/failures.ts";
import { judge, QUARANTINE_MAX, type Quarantined, UNFILED } from "../scripts/quarantine.ts";

const fail = (n: number): Failure => ({ file: "test/a.test.ts", test: `t${n}` });
const held = (n: number): Quarantined => ({ file: "test/a.test.ts", test: `t${n}`, task: "LIN-9" });

test("a flake passes alone and is quarantined, a break fails alone and still fails, a 6th flake fails", async () => {
  const flake = fail(1);
  const brk = fail(2);
  const alone = async (f: Failure) => f !== brk;

  const first = await judge([flake], [], alone);
  expect(first.blocking).toEqual([]);
  expect(first.list).toEqual([{ file: "test/a.test.ts", test: "t1", task: UNFILED }]);

  const broken = await judge([brk], [], alone);
  expect(broken.blocking).toEqual([brk]);
  expect(broken.list).toEqual([]);

  const full = [1, 2, 3, 4, 5].map(held);
  expect(full).toHaveLength(QUARANTINE_MAX);
  const sixth = await judge([fail(6)], full, async () => true);
  expect(sixth.blocking).toEqual([fail(6)]);
  expect(sixth.list).toEqual(full);
});

test("a quarantined test's failure alone is not rerun and does not fail", async () => {
  const v = await judge([{ file: "./test/a.test.ts", test: "t1" }], [held(1)], async () => false);
  expect(v.blocking).toEqual([]);
  expect(v.quarantined).toHaveLength(1);
});
