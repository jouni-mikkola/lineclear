import { expect, test } from "bun:test";
import { apply, diff } from "../src/live-diff.ts";

const roundTrip = (a: unknown, b: unknown) => expect(apply(a, diff(a, b))).toEqual(b);

test("equal answers have no operations", () => {
  expect(diff({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual([]);
});

test("one changed value is one small operation", () => {
  const a = {
    tasks: [
      { id: "A-1", state: "work" },
      { id: "A-2", state: "done" },
    ],
  };
  const b = {
    tasks: [
      { id: "A-1", state: "done" },
      { id: "A-2", state: "done" },
    ],
  };
  expect(diff(a, b)).toEqual([{ p: ["tasks", 0, "state"], v: "done" }]);
  roundTrip(a, b);
});

test("added and removed keys and appended items round-trip", () => {
  roundTrip({ a: 1, b: 2 }, { a: 1, c: 3 });
  roundTrip({ list: [1, 2] }, { list: [1, 2, 3, 4] });
  roundTrip({ list: [1, 2, 3] }, { list: [1] });
  roundTrip([1], "text");
  roundTrip({ a: null }, { a: { x: 1 } });
});

test("applying leaves the old value as it was", () => {
  const a = { x: { y: 1 }, z: { w: 1 } };
  const b = apply(a, diff(a, { x: { y: 2 }, z: { w: 1 } })) as typeof a;
  expect(a.x.y).toBe(1);
  expect(b.z).toBe(a.z);
});
