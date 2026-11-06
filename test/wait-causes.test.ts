import { expect, test } from "bun:test";
import { measure, type Measured, type TaskInfo } from "../src/measure.ts";
import { causeLine, causeTotals, unexplainedWaits } from "../src/wait-causes.ts";

const at = (hhmm: string) => Date.parse(`2026-01-01T${hhmm}:00Z`);
const task = (step: string, start: string): TaskInfo => ({ id: `T-${step}`, title: `${step} title`, start: at(start), worktree: `/w/${step}` });
const line = (step: string, time: string, kind: string, reason: string) => ({ step, at: at(time), kind, reason });

/**
 * A merges at 10:00, so B, C and D are ready then. Counted by hand:
 * B starts 10:50: nothing recorded 10:00 to 10:10 (10), lock 10:10 to 10:40 (30), slot 10:40 to 10:50 (10).
 * C starts 11:00: nothing 10:00 to 10:05 (5), load 10:05 to 10:45 (40), nothing 10:45 to 11:00 (15).
 * D starts 10:45: a file held from 09:30, before it was ready, so 10:00 to 10:30 (30), then quota 10:30 to 10:45 (15).
 */
const fixture: Measured = {
  asks: [],
  steps: [
    { id: "A", after: ["none"], merged: at("10:00") },
    { id: "B", after: ["A"] },
    { id: "C", after: ["A"] },
    { id: "D", after: ["A"] },
  ],
  tasks: [task("B", "10:50"), task("C", "11:00"), task("D", "10:45")],
  usageOf: () => undefined,
  priceOf: () => undefined,
  decisions: [
    line("B", "10:10", "skip", "lock 'measure-wait' is held by LINE-1"),
    line("B", "10:40", "skip", "no free slot in space 'p' (2 of 2 working)"),
    line("B", "10:50", "start", "ready, locks free, slot free"),
    line("C", "10:05", "skip", "load average is above the limit of 4, no new task starts"),
    line("C", "10:45", "wake", "no longer skipped: load average is above the limit of 4, no new task starts"),
    line("D", "09:30", "skip", "lock 'file:src/rules.ts' is held by LINE-2"),
    line("D", "10:30", "skip", "every account is ahead of its weekly pace: only the critical path starts"),
  ],
};

test("each step's wait is split by the cause the decision log recorded", () => {
  const waits = measure(fixture, "2026-01-01").waitCauses;
  expect(waits.map((w) => [w.step, causeLine(w.minutes)])).toEqual([
    ["B", "lock 30.0 min, slot 10.0 min, no cause recorded 10.0 min"],
    ["C", "machine load 40.0 min, no cause recorded 20.0 min"],
    ["D", "part 30.0 min, quota 15.0 min"],
  ]);
  expect(causeTotals(waits).map(([c, m]) => `${c} ${m}`)).toEqual(["machine load 40", "lock 30", "part 30", "no cause recorded 30", "quota 15", "slot 10"]);
});

test("a wait over one tick with no recorded cause is named, one inside a tick is not", () => {
  const waits = [
    { step: "A", minutes: { "no cause recorded": 0.4 } },
    { step: "B", minutes: { "no cause recorded": 2, lock: 30 } },
    { step: "C", minutes: { lock: 10 } },
  ];
  expect(unexplainedWaits(waits, 30_000)).toEqual([{ step: "B", minutes: 2 }]);
});

test("the median minutes a lock is held after its task ended", () => {
  // H's task ends 10:00. B waited on H's lock until 10:20 (20 min after the end), C until 10:00 (0): one lock, held 20 min.
  const m: Measured = {
    asks: [],
    steps: [
      { id: "A", after: ["none"], merged: at("09:00") },
      { id: "H", after: ["none"] },
      { id: "B", after: ["A"] },
      { id: "C", after: ["A"] },
    ],
    tasks: [{ ...task("H", "09:10"), end: at("10:00") }, task("B", "10:20"), task("C", "10:00")],
    usageOf: () => undefined,
    priceOf: () => undefined,
    decisions: [
      line("B", "09:30", "skip", "lock 'ui' is held by H"),
      line("B", "10:20", "start", "ready"),
      line("C", "09:30", "skip", "lock 'ui' is held by H"),
      line("C", "10:00", "start", "ready"),
    ],
  };
  expect(measure(m, "2026-01-01").lockAfterEnd).toEqual({ median: 20, locks: 1 });
  // a later retry of H changes nothing
  const later = { ...m, tasks: [...m.tasks, task("H", "10:30")] };
  expect(measure(later, "2026-01-01").lockAfterEnd).toEqual({ median: 20, locks: 1 });
  expect(measure({ ...m, decisions: [] }, "2026-01-01").lockAfterEnd).toBeNull();
});
