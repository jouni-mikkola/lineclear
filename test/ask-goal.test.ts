import { expect, test } from "bun:test";
import { askGoal, askGoalFailure, askGoalLine } from "../src/ask-goal.ts";
import type { Numbers } from "../src/measure.ts";

/** Three days in the window, the last with `last` asks; the first has no work. */
const fixture = (last: number) =>
  ({
    days: [
      { date: "2026-01-02", asks: 0, turns: 0, wait: null, lane: null, cost: null },
      { date: "2026-01-03", asks: 2, turns: 4, wait: null, lane: null, cost: null },
      { date: "2026-01-04", asks: last, turns: 1, wait: null, lane: null, cost: null },
    ],
  }) as unknown as Numbers;

test("the goal holds at 2 asks and fails at 3, naming the day", () => {
  const ok = askGoal(fixture(2), "2026-01-04");
  expect(askGoalFailure(ok)).toBeUndefined();
  expect(askGoalLine(ok, "2026-01-04")).toBe("- 2026-01-04: asks per day with work: 2026-01-03 2, 2026-01-04 2");
  expect(askGoalFailure(askGoal(fixture(3), "2026-01-04"))).toContain("2026-01-04 had 3 asks");
});

test("no day with work is no failure", () => {
  expect(askGoalFailure(askGoal({ days: [] } as unknown as Numbers, "2026-01-04"))).toBeUndefined();
});
