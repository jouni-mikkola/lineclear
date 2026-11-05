import { expect, test } from "bun:test";
import type { RoadmapStep } from "../src/roadmap-view.ts";
import { roadmapSample } from "../ui/web/roadmap-samples.ts";
import { changesSince, takeLook } from "../ui/web/roadmap/since-look.tsx";

const find = (steps: RoadmapStep[], state: RoadmapStep["state"]) => {
  const s = steps.find((x) => x.state === state);
  if (!s) throw new Error(`no ${state} step`);
  return s;
};
const ids = (steps: { id: string }[]) => steps.map((s) => s.id);

test("a look with nothing changed finds nothing", () => {
  const d = roadmapSample("filled", "demo");
  const c = changesSince(d, takeLook(d, Date.now()));
  expect([c.merged, c.started, c.waits].map((x) => x.length)).toEqual([0, 0, 0]);
});

test("a merge, a start and a new wait since the look are each found", () => {
  const base = roadmapSample("filled", "demo");
  const work = find(base.steps, "work");
  // before the look the work step is at work, not yet waiting for the human
  const d = { ...base, steps: base.steps.map((s) => (s.id === work.id ? { ...s, task: { ...s.task, status: "work" } } : s)) };
  const look = takeLook(d, Date.now());
  const ready = find(d.steps, "ready");
  const next = find(d.steps, "waiting");
  const later = {
    ...d,
    steps: d.steps.map((s) =>
      s.id === work.id
        ? { ...s, task: { ...s.task, status: "need" } }
        : s.id === ready.id
          ? { ...s, state: "work" as const, task: { status: "work" } }
          : s.id === next.id
            ? { ...s, state: "done" as const }
            : s,
    ),
    history: [{ step: next.id, at: look.at + 1000, commit: "abc", subject: "merged" }, ...d.history],
  };
  const c = changesSince(later, look);
  expect(ids(c.merged)).toEqual([next.id]);
  expect(ids(c.started)).toEqual([ready.id]);
  expect(ids(c.waits)).toEqual([work.id]);
});
