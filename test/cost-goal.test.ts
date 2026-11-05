import { expect, test } from "bun:test";
import { costGoal, costGoalFailure, costGoalLine } from "../src/cost-goal.ts";
import type { Numbers } from "../src/measure.ts";

/** Two days of 2 and 3 steps at `perStep` dollars, cache write the largest share. */
const fixture = (perStep: number) =>
  ({
    days: [
      { date: "2026-01-02", cost: { perStep, tokens: 1, steps: 2 } },
      { date: "2026-01-03", cost: { perStep, tokens: 1, steps: 3 } },
      { date: "2026-01-04", cost: null },
    ],
    causes: [
      { cause: "input", perStep: 0.1, share: 0.1 },
      { cause: "cacheWrite", perStep: 0.6, share: 0.6 },
      { cause: "output", perStep: 0.3, share: 0.3 },
    ],
  }) as unknown as Numbers;

test("the goal holds at $1.10 and fails at $1.30, naming the largest share", () => {
  const ok = costGoal(fixture(1.1));
  expect(ok.steps).toBe(5);
  expect(costGoalFailure(ok)).toBeUndefined();
  expect(costGoalLine(ok, "2026-01-04")).toBe("- 2026-01-04: $1.10 per merged step over 5 steps");

  const bad = costGoalFailure(costGoal(fixture(1.3)));
  expect(bad).toContain("$1.30 over 5 steps");
  expect(bad).toContain("largest share: cache write (60.0 %)");
});

test("no priced step is no failure", () => {
  expect(costGoalFailure(costGoal({ days: [], causes: [] } as unknown as Numbers))).toBeUndefined();
});
