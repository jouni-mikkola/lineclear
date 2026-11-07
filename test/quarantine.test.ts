import { expect, test } from "bun:test";
import { judge, QUARANTINE_MAX, type Quarantined } from "../scripts/quarantine.ts";

const alone = (passes: Record<string, boolean>) => new Map(Object.entries(passes));
const listed = (n: number): Quarantined[] => Array.from({ length: n }, (_, i) => ({ test: `old${i}`, fix: `LIN-${i}` }));

test("a listed flake that passes alone does not fail the check", () => {
  const v = judge(["a"], alone({ a: true }), [{ test: "a", fix: "LIN-1" }]);
  expect(v).toMatchObject({ ok: true, ignored: ["a"], added: [] });
});

test("a test that fails alone too still fails, listed or not", () => {
  expect(judge(["a"], alone({ a: false }), [{ test: "a", fix: "LIN-1" }]).ok).toBe(false);
  expect(judge(["b"], alone({ b: false }), []).faults).toEqual(["b fails alone too"]);
});

test("a new flake joins the list up to the limit, and the one past it fails", () => {
  expect(judge(["new"], alone({ new: true }), listed(QUARANTINE_MAX - 1))).toMatchObject({ ok: true, added: ["new"] });
  const sixth = judge(["new"], alone({ new: true }), listed(QUARANTINE_MAX));
  expect(sixth.ok).toBe(false);
  expect(sixth.faults[0]).toContain("limit is 5");
});

test("a flake and a break together still fail", () => {
  expect(judge(["f", "b"], alone({ f: true, b: false }), []).ok).toBe(false);
});
