import { expect, test } from "bun:test";
import { doneMeansLines, type GoalStep, goalsOf, type Hold } from "../src/goals.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 15, 12);

const text = `# Roadmap

**Done means.** All of it.
- Pay works (A1 to A2).
- Search is fast (B1) and
  forgiving.

## P
### A1 One
### A2 Two
### B1 Three
`;
const step = (id: string, state: GoalStep["state"], after: string[] = []): GoalStep => ({ id, title: `Step ${id}`, phase: "P", state, after });
const merge = (id: string, ago: number) => ({ at: NOW - ago, subject: `T-1: ${id} x`, body: "" });

test("each Done means line is a goal; a line continues on the next", () => {
  expect(doneMeansLines(text)).toEqual(["Pay works (A1 to A2).", "Search is fast (B1) and forgiving."]);
});

test("a goal names its steps, ranges included, and the title drops the ids", () => {
  const goals = goalsOf(text, [step("A1", "done"), step("A2", "ready", ["A1"]), step("B1", "work")], new Map(), [merge("A1", DAY)], NOW);
  expect(goals.map((g) => [g.title, g.steps, g.column, g.done, g.total])).toEqual([
    ["Pay works.", ["A1", "A2"], "next", 1, 2],
    ["Search is fast and forgiving.", ["B1"], "now", 0, 1],
  ]);
  expect(goals.map((g) => g.confidence)).toEqual(["on track", "on track"]);
});

test("without Done means the phases are the goals", () => {
  const goals = goalsOf("## P\n### A1 One\n", [step("A1", "waiting")], new Map(), [], NOW);
  expect(goals.map((g) => [g.title, g.column])).toEqual([["P", "later"]]);
});

test("a goal is at risk when a step on its critical path waits for you, a quota or a stall", () => {
  const steps = [step("A1", "work"), step("A2", "waiting", ["A1"]), step("B1", "ready")];
  for (const hold of ["you", "quota", "stall"] as Hold[]) {
    const [pay, search] = goalsOf(text, steps, new Map([["A1", hold]]), [], NOW);
    expect(pay?.confidence).toBe("at risk");
    expect(search?.confidence).toBe("on track");
  }
});

test("a goal is late when its expected date moved later in 7 days, and done when nothing is left", () => {
  const steps = [step("A1", "done"), step("A2", "ready", ["A1"]), step("B1", "done")];
  // a week ago the pace was 5 merges a week; now it is 1
  const commits = [merge("A1", 8 * DAY), merge("B1", 2 * DAY)];
  const [pay, search] = goalsOf(text, steps, new Map(), commits, NOW);
  expect(search?.confidence).toBe("done");
  expect(pay?.confidence).toBe("late");
  expect(pay?.reason).toContain("Expected");
});
