import { expect, test } from "bun:test";
import type { Measured, TaskInfo } from "../src/measure.ts";
import { appendGoalLine, waitGoalFailure, waitGoalLine, waitGoalOf } from "../src/wait-goal.ts";

const at = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00Z`);
const task = (step: string, start: number): TaskInfo => ({ id: `T-${step}`, title: `${step} title`, start, worktree: `/w/${step}` });

/** Three steps ready when A merges at 10:00 on 2026-01-03; each waits `wait` minutes on a full slot. */
const recorded = (wait: number): Measured => {
  const start = at("2026-01-03", "10:00") + wait * 60_000;
  return {
    asks: [],
    steps: [
      { id: "A", after: ["none"], merged: at("2026-01-03", "10:00") },
      { id: "B", after: ["A"] },
      { id: "C", after: ["A"] },
      { id: "D", after: ["A"] },
    ],
    tasks: [task("B", start), task("C", start), task("D", start)],
    usageOf: () => undefined,
    priceOf: () => undefined,
    decisions: ["B", "C", "D"].map((step) => ({ step, at: at("2026-01-03", "10:00"), kind: "skip", reason: "no free slot in space 'p' (2 of 2 working)" })),
  };
};

test("the goal holds at a median wait of 4 min and fails at 6 min, naming the largest cause", () => {
  const ok = waitGoalOf(recorded(4), "2026-01-04");
  expect(ok.median).toBe(4);
  expect(ok.counts).toEqual([
    { date: "2026-01-02", tasks: 0 },
    { date: "2026-01-03", tasks: 3 },
    { date: "2026-01-04", tasks: 0 },
  ]);
  expect(waitGoalFailure(ok)).toBeUndefined();

  const bad = waitGoalOf(recorded(6), "2026-01-04");
  expect(bad.median).toBe(6);
  expect(waitGoalFailure(bad)).toContain("largest cause: slot (18.0 min)");
});

test("the numbers file gets one line a day under L238", () => {
  const g = waitGoalOf(recorded(4), "2026-01-04");
  const line = waitGoalLine(g, "2026-01-04");
  const once = appendGoalLine("# Numbers\n\n## L57\n\ntext\n", line);
  expect(once).toBe(`# Numbers\n\n## L57\n\ntext\n\n## L238\n\n${line}\n`);
  const next = appendGoalLine(`${once}\n## L239\n\nx\n`, waitGoalLine(g, "2026-01-05"));
  expect(next).toContain(`${line}\n- 2026-01-05:`);
  expect(next.indexOf("2026-01-05")).toBeLessThan(next.indexOf("## L239"));
  expect(appendGoalLine(next, line.replace("4.0", "9.0")).match(/2026-01-04:/g)).toHaveLength(1);
});
