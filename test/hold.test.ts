import { expect, test } from "bun:test";
import { holdWorld } from "../src/hold.ts";
import type { Settings } from "../src/project.ts";
import { idleWorld } from "./demo-world.ts";

function world(sent: string[]) {
  return idleWorld(process.env, {
    tasks: () => [
      { id: "LIN-1", title: "a", status: "need", stopped: true },
      { id: "LIN-2", title: "b", status: "need" },
    ],
    tellTask: (id) => {
      sent.push(`tell ${id}`);
      return undefined;
    },
    nudge: (id) => {
      sent.push(`nudge ${id}`);
      return undefined;
    },
    stopTask: (id) => {
      sent.push(`stop ${id}`);
      return undefined;
    },
    addTasks: (_s, jobs) => jobs.map(() => (sent.push("add"), undefined)),
  });
}

test("a task the owner stopped is never written to, and another task is", () => {
  const sent: string[] = [];
  const w = holdWorld(world(sent), { space: "s" } as Settings);
  expect(w.tellTask("LIN-1", "x", "resume")).toContain("stopped");
  expect(w.nudge("LIN-1", "x")).toContain("stopped");
  expect(w.tellTask("LIN-2", "x", "resume")).toBeUndefined();
  expect(sent).toEqual(["tell LIN-2"]);
});

test("a paused project's tasks are not told, restarted or started", () => {
  const sent: string[] = [];
  const settings = { space: "s", paused: true } as Settings;
  const w = holdWorld(world(sent), settings);
  const added = w.addTasks(settings, [{ title: "t", brief: "b", extra: [] }]);
  for (const r of [w.tellTask("LIN-2", "x"), w.nudge("LIN-2", "x"), w.stopTask("LIN-2"), ...added]) expect(r).toContain("paused");
  expect(sent).toEqual([]);
});
