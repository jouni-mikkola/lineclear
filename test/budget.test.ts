import { expect, test } from "bun:test";
import { broken, type Numbers } from "../scripts/budget.ts";
import { loadFactor } from "../scripts/check-speed.ts";

const budgets = { network: { rttMs: 100 }, firstViewMs: 1000, idleCpuPercent: 1, idleMemoryMb: 300 };
const ok: Numbers = { firstViewMs: 600, idleCpuPercent: 0.5, idleMemoryMb: 100, notGzipped: [] };

test("a run inside every budget has no faults", () => {
  expect(broken(budgets, ok)).toEqual([]);
});

test("each number over its budget, and an answer that is not compressed, is named", () => {
  const faults = broken(budgets, { ...ok, firstViewMs: 1200, notGzipped: ["/api/home"] });
  expect(faults).toEqual(["firstViewMs: 1200.00, over its budget of 1000", "answers not compressed: /api/home"]);
});

test("a time limit grows with the load of the run; the other limits stay absolute", () => {
  expect(loadFactor(2, 8)).toBe(1);
  expect(loadFactor(20, 8)).toBe(2.5);
  const slow = { ...ok, firstViewMs: 1400, idleCpuPercent: 1.4, idleMemoryMb: 400 };
  expect(broken(budgets, slow, 2.5)).toEqual(["idleMemoryMb: 400.00, over its budget of 300"]);
  expect(broken(budgets, { ...ok, firstViewMs: 2600 }, 2.5)).toEqual(["firstViewMs: 2600.00, over its budget of 2500 (1000 at load 2.5x)"]);
});
