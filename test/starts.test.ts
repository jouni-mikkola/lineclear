import { afterAll, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseRoadmap } from "../src/roadmap.ts";
import { readState } from "../src/rules.ts";
import { AGE_TICKS, agentStart, nudgePane, lockWhy, reservedLocks } from "../src/starts.ts";
import { tmp } from "./helpers.ts";
import { setup, step } from "./rules-world.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const ok = (out = "") => ({ code: 0, out });

test("a start counts only when its pi session holds an answer; a missing agent or an empty session never does", () => {
  const dir = tmp("starts");
  dirs.push(dir);
  const file = join(dir, "s.jsonl");
  const get = (status: string, session?: string) =>
    JSON.stringify({ result: { agent: { agent_status: status, ...(session ? { agent_session: { value: session } } : {}) } } });
  const fake =
    (out: string, pane = "") =>
    (cmd: string[]) =>
      cmd[2] === "get" ? ok(out) : ok(pane);
  // the planted fault: herdr knows no such agent, and pi's session folder is empty
  const lost = () => ({ code: 1, out: "agent_not_ready: not an active named agent" });
  expect(agentStart("LIN-5", lost)).toEqual({ kind: "gone" });
  expect(agentStart("LIN-5", lost, "/work", () => dir)).toEqual({ kind: "gone" });
  expect(agentStart("LIN-5", fake(get("idle")))).toEqual({ kind: "silent" });
  expect(agentStart("LIN-5", fake(get("unknown", join(dir, "none.jsonl"))))).toEqual({ kind: "silent" });
  writeFileSync(file, '{"type":"message","message":{"role":"user"}}\n');
  expect(agentStart("LIN-5", fake(get("idle", file)))).toEqual({ kind: "silent" });
  expect(agentStart("LIN-5", fake(get("working", file)))).toEqual({ kind: "busy" });
  expect(agentStart("LIN-5", fake(get("working", file), "> [paste #1 +40 lines]"))).toEqual({ kind: "silent" });
  writeFileSync(
    file,
    '{"type":"message","message":{"role":"user"}}\n{"type":"message","timestamp":"2026-06-01T10:00:05.000Z","message":{"role":"assistant"}}\n',
  );
  expect(agentStart("LIN-5", fake(get("idle", file)))).toEqual({ kind: "acted" });
  // an agent herdr lost after it answered: its session folder still shows the answer
  expect(agentStart("LIN-5", lost, "/work", () => dir)).toEqual({ kind: "acted" });
});

test("a nudge types into the pane of the task's worktree, and asks the named agent when no pane runs there", () => {
  const work = "/work/lin-5";
  const calls: string[][] = [];
  const panes = (cwd: string) => (cmd: string[]) => {
    calls.push(cmd);
    return cmd[2] === "list" ? ok(JSON.stringify({ result: { panes: [{ pane_id: "w1:p2", cwd }] } })) : ok();
  };
  expect(nudgePane("LIN-5", "begin", panes(work), work)).toBeUndefined();
  expect(calls.slice(2)).toEqual([
    ["herdr", "pane", "send-text", "w1:p2", "begin"],
    ["herdr", "pane", "send-keys", "w1:p2", "Enter"],
  ]);
  calls.length = 0;
  expect(nudgePane("LIN-5", "begin", panes("/elsewhere"), work)).toBeUndefined();
  expect(calls.slice(1)).toEqual([["herdr", "agent", "prompt", "shep-lin-5", "begin"]]);
  expect(nudgePane("LIN-5", "begin", (cmd) => (cmd[2] === "list" ? ok("{}") : { code: 1, out: "no agent" }), undefined)).toBe("no agent");
});

test("a pane that still shows the pasted brief gets Enter only, never the nudge text", () => {
  const calls: string[][] = [];
  const run = (cmd: string[]) => {
    calls.push(cmd);
    if (cmd[2] === "list") return ok(JSON.stringify({ result: { panes: [{ pane_id: "w1:p2", cwd: "/work" }] } }));
    return ok(cmd[2] === "read" ? "[paste #1 +40 lines]" : "");
  };
  expect(nudgePane("LIN-5", "begin", run, "/work")).toBeUndefined();
  expect(calls.some((c) => c[2] === "send-text")).toBe(false);
  expect(calls.at(-1)).toEqual(["herdr", "pane", "send-keys", "w1:p2", "Enter"]);
});

const running = [{ id: "LIN-1", title: "R Title R", status: "work" }];

const seed = (t: ReturnType<typeof setup>, state: object) => {
  mkdirSync(join(t.config, "projects", "demo"), { recursive: true });
  writeFileSync(join(t.config, "projects", "demo", "state.json"), JSON.stringify(state));
};

test("a step skipped for locks counts its ticks, and one that starts or is free starts over", () => {
  const t = setup({ steps: [step("R", "none", "b"), step("B", "none", "a,b")], tasks: running });
  seed(t, { taskSteps: { "LIN-1": "R" } });
  for (let i = 1; i <= 3; i++) {
    t.doTick();
    expect(readState("demo", t.env).lockWaits).toEqual({ B: i });
  }
});

test("a broad step skipped for 10 ticks keeps its locks from a newer narrow step, and starts once its holder is gone", () => {
  const steps = [step("R", "none", "b"), step("B", "none", "a,b"), step("N", "none", "a")];
  const t = setup({ steps, tasks: running });
  seed(t, { taskSteps: { "LIN-1": "R" }, lockWaits: { B: AGE_TICKS - 1 } });
  // below ten ticks the narrow step still takes lock a
  expect(t.doTick().find((x) => x.step === "N")?.kind).toBe("start");
  const aged = setup({ steps, tasks: running });
  seed(aged, { taskSteps: { "LIN-1": "R" }, lockWaits: { B: AGE_TICKS } });
  expect(aged.doTick().find((x) => x.step === "N")?.reason).toContain("lock 'a' is reserved for B");
  // its holder merged: the broad step starts first, the narrow one waits behind it
  const free = setup({ steps, tasks: [] });
  seed(free, { lockWaits: { B: AGE_TICKS } });
  const first = free.doTick().map((x) => `${x.step}:${x.kind}`);
  expect(first).toContain("B:start");
  expect(first).toContain("N:skip");
});

test("reservations go to the oldest waiting step, and a step reserves nothing under ten ticks", () => {
  const byId = new Map(parseRoadmap(`## P\n\n${step("A", "none", "x")}\n${step("B", "none", "x,y")}`).steps.map((s) => [s.id, s]));
  const status = [...byId.keys()].map((id) => ({ id, state: "ready" }));
  expect(reservedLocks(status, byId, { A: AGE_TICKS - 1, B: AGE_TICKS - 1 }).size).toBe(0);
  const reserved = reservedLocks(status, byId, { A: AGE_TICKS, B: AGE_TICKS + 3 });
  expect(reserved.get("x")).toBe("B");
  expect(lockWhy(byId.get("A")!, new Map(), reserved)).toContain("reserved for B");
  expect(lockWhy(byId.get("B")!, new Map(), reserved)).toBeUndefined();
});

test("the same step added twice starts once and is refused once, and a landed step starts nothing", () => {
  const t = setup({ steps: [step("A", "none")] });
  t.doTick();
  t.doTick();
  expect(t.adds().length).toBe(1);
  expect(t.decisions().some((x) => x.step === "A" && x.reason.includes("does not start twice"))).toBe(true);
  const landed = setup({ steps: [step("A", "none")], tasks: [{ id: "LIN-1", title: "A Title A", status: "done", closed: true, closedBy: "done" }] });
  writeFileSync(join(landed.config, "projects", "demo", "state.json"), JSON.stringify({ taskSteps: { "LIN-1": "A" }, closedSteps: { A: "LIN-1" } }));
  landed.doTick();
  expect(landed.adds()).toEqual([]);
});
