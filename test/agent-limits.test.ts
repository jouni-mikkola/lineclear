import { expect, test } from "bun:test";
import { noteWorkSeen, overTime } from "../src/agent-limits.ts";
import type { State } from "../src/rules.ts";

const MIN = 60_000;
const now = new Date("2026-11-06T12:00:00Z");
const state = { taskSeen: { "(at work)": { "LIN-1": now.getTime() - 130 * MIN, "LIN-2": now.getTime() - 60 * MIN } } } as unknown as State;

test("a task at work past the wall-time limit is over, a younger or unseen one is not", () => {
  const tasks = [
    { id: "LIN-1", title: "a", status: "work" },
    { id: "LIN-2", title: "b", status: "work" },
    { id: "LIN-3", title: "c", status: "work" },
    { id: "LIN-4", title: "d", status: "need" },
  ];
  expect(overTime(state, tasks, now)).toEqual([{ id: "LIN-1", minutes: 130 }]);
  expect(overTime(state, tasks, now, 45).map((o) => o.id)).toEqual(["LIN-1", "LIN-2"]);
});

test("a task at work is remembered when first seen, so its wall time runs", () => {
  const s = {} as State;
  const tasks = [{ id: "LIN-9", title: "x", status: "work" }];
  noteWorkSeen(s, tasks, new Date(now.getTime() - 130 * MIN));
  noteWorkSeen(s, tasks, now);
  expect(overTime(s, tasks, now)).toEqual([{ id: "LIN-9", minutes: 130 }]);
});
