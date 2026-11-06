import { expect, test } from "bun:test";
import type { Settings } from "../src/project.ts";
import type { State, World } from "../src/rules.ts";
import { unstick } from "../src/unstick.ts";

type T = { id: string; title: string; status: string; sub?: string };

function fake(tasks: T[], o: { clean?: boolean; wrote?: boolean; ahead?: number; mergeError?: string } = {}) {
  const calls: string[] = [];
  let at = Date.parse("2026-11-05T10:00:00Z");
  const world = {
    now: () => new Date(at),
    tasks: () => tasks,
    clean: () => o.clean ?? true,
    branchOf: () => "work/1-x",
    commitsAhead: () => o.ahead ?? 1,
    ownerWrote: () => o.wrote ?? false,
    closeTask: (id: string) => (calls.push(`close ${id}`), undefined),
    mergeTask: (id: string) => (calls.push(`merge ${id}`), o.mergeError),
    showCause: (id: string, cause: string) => (calls.push(`cause ${id} ${cause}`), undefined),
  } as unknown as World;
  const state = { taskSteps: { "LIN-1": "L1" } } as unknown as State;
  const tick = (waits: { task: string }[] = [], dryRun = false) =>
    unstick({ project: "p", settings: { space: "s" } as Settings, world, state, waits: waits as never, dryRun });
  return { calls, tick, later: (min: number) => (at += min * 60_000) };
}

const wrong = { id: "LIN-1", title: "L1 x", status: "need", sub: "Went wrong: the worktree could not be made" };

test("a task of the rules whose start went wrong is closed, one with work or one made by hand is not", () => {
  const a = fake([wrong]);
  expect(a.tick()).toEqual([]);
  a.later(4);
  expect(a.tick()[0]?.kind).toBe("close");
  expect(a.calls).toEqual(["close LIN-1"]);
  const dirty = fake([wrong], { clean: false });
  dirty.tick();
  dirty.later(4);
  dirty.tick();
  const byHand = fake([{ ...wrong, id: "LIN-2" }]);
  byHand.tick();
  byHand.later(4);
  byHand.tick();
  expect([...dirty.calls, ...byHand.calls]).toEqual([]);
  const dry = fake([wrong]);
  dry.tick([], true);
  dry.later(4);
  dry.tick([], true);
  expect(dry.calls).toEqual([]);
});

test("a task on Ready to merge has its merge started after 10 minutes, one at a time, never with a wait or after the owner wrote", () => {
  const ready = { id: "LIN-3", title: "x", status: "ready", sub: "Ready to merge" };
  const second = { id: "LIN-4", title: "y", status: "ready", sub: "Ready to merge" };
  const a = fake([ready, second]);
  a.tick();
  a.later(9);
  a.tick();
  expect(a.calls).toEqual([]);
  a.later(2);
  a.tick();
  expect(a.calls).toEqual(["merge LIN-3"]);
  a.tick();
  expect(a.calls).toEqual(["merge LIN-3", "merge LIN-4"]);
  for (const o of [{ wrote: true }, {}]) {
    const b = fake([ready], o);
    b.tick(o.wrote ? [] : [{ task: "LIN-3" }]);
    b.later(20);
    b.tick(o.wrote ? [] : [{ task: "LIN-3" }]);
    expect(b.calls).toEqual([]);
  }
});

test("a merge that fails twice shows its cause on the card and is not tried again", () => {
  const ready = { id: "LIN-3", title: "x", status: "ready", sub: "Ready to merge" };
  const a = fake([ready], { mergeError: "check failed" });
  a.tick();
  a.later(11);
  a.tick();
  a.tick();
  expect(a.calls).toEqual(["merge LIN-3"]);
  a.later(11);
  a.tick();
  expect(a.calls).toEqual(["merge LIN-3", "merge LIN-3", "cause LIN-3 check failed"]);
  a.later(60);
  a.tick();
  expect(a.calls.length).toBe(3);
});

test("a start with no worktree is closed only when its branch holds no commit", () => {
  const empty = fake([wrong], { clean: false, ahead: 0 });
  empty.tick();
  empty.later(4);
  expect(empty.tick()[0]?.kind).toBe("close");
  const work = fake([wrong], { clean: false, ahead: 2 });
  work.tick();
  work.later(4);
  expect(work.tick()).toEqual([]);
});
