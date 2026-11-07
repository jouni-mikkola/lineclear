import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decisionsPath, tick, type Decision, type State } from "../src/rules.ts";
import { CLASS_INFO, classify, watchStalls, type Observation } from "../src/stall-class.ts";
import { stepStatuses, type Step, type Task } from "../src/roadmap.ts";
import { recordTaskSteps } from "./helpers.ts";
import { fakeWorld, scratch } from "./fake-world.ts";

const scratchDir = scratch();
const MIN = 60_000;

const ROADMAP = `# Roadmap

## Phase 0

### A Alpha
- why: because
- done when:
  - it works
- locks: none
- after: none
`;

type T = { id: string; title: string; status: string; sub?: string };

/** One project that is Lineclear's own, a fake clock and a fake task list. */
function setup(list: T[] = [{ id: "LIN-5", title: "A Alpha", status: "work" }], commits: { subject: string; body: string }[] = []) {
  const dir = scratchDir("stall-class");
  const config = join(dir, "config");
  mkdirSync(join(config, "projects", "demo"), { recursive: true });
  const models = { worker: ["anthropic/claude-sonnet-5-5"], reviewer: ["anthropic/claude-opus-5-5"], planner: ["anthropic/claude-opus-5-5"] };
  writeFileSync(join(config, "projects", "demo", "settings.json"), JSON.stringify({ repo: dir, space: "demo", check: "true", self: true, models }));
  writeFileSync(join(config, "machine.json"), JSON.stringify({ loadLimit: 1e6 }));
  recordTaskSteps(config, Object.fromEntries(list.filter((t) => t.id !== "LIN-198").map((t) => [t.id, t.title.split(" ")[0] as string])));
  // the loop copies the store and sweeps the temp folder: own ones keep it off the real store and the other runs' folders
  const tmp = join(dir, "tmp");
  mkdirSync(tmp);
  const env = {
    ...process.env,
    LINECLEAR_CONFIG: config,
    TMPDIR: tmp,
    LINECLEAR_HOME: join(dir, "home"),
    LINECLEAR_STORE_COPIES: join(dir, "copies"),
    XDG_CACHE_HOME: join(dir, "cache"),
  };
  const { world, clock, log, adds, cards, tasks } = fakeWorld(env, list, ROADMAP, commits);
  const decisions = (): Decision[] =>
    readFileSync(decisionsPath(env), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  const jump = (ms: number) => {
    clock.at = new Date(clock.at.getTime() + ms);
    return tick(world, false, env);
  };
  const stateFile = join(config, "projects", "demo", "state.json");
  // the loop ticks every few minutes, so a long wait is no coordinator gone: tick as if the last tick was a minute ago
  const step = (ms: number) => {
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      state.last ??= {};
      state.last["~tick"] = new Date(clock.at.getTime() + ms - MIN).toISOString();
      writeFileSync(stateFile, JSON.stringify(state));
    }
    return jump(ms);
  };
  return { env, world, log, adds, cards, tasks, clock, decisions, step, jump, settingsFile: join(config, "projects", "demo", "settings.json") };
}

test("each class is named from its reason, and the owner's waits are no stall", () => {
  const c = (reason: string, kind: Decision["kind"] = "skip") => classify({ kind, reason });
  expect(c("LIN-5 is signed out of anthropic")).toBe("signed-out");
  expect(c("no worker model has room: anthropic is full until 12:00")).toBe("account-full");
  expect(c("LIN-5: Lineclear couldn't start it again")).toBe("revive-loop");
  expect(c("the health command failed on main abc")).toBe("main-red");
  expect(c("lock 'rules' is held by L12")).toBe("lock-held");
  expect(c("no free slot in the space")).toBe("no-room");
  expect(c("the roadmap is broken: L9 has no why")).toBe("roadmap-broken");
  expect(c("the repo folder is not at origin/main")).toBe("repo-off-main");
  expect(c("machine m2 skipped: ssh timed out")).toBe("machine-unreachable");
  expect(c("the coordinator of banking-app cannot restart")).toBe("coordinator-gone");
  expect(c("LIN-5's merge isn't through after 90 s (another merge into this repo still runs)")).toBe("head-of-line");
  expect(c("lineclear task list failed: exit 1")).toBe("command-failed");
  expect(c("rung 1: told LIN-5 it may be stuck", "stall")).toBe("no-sign-of-life");
  expect(c("pressed Enter for LIN-5: its agent is idle and never started", "stall")).toBe("brief-unsent");
  expect(c("LIN-5: its agent never answered, but the nudge failed: no pane")).toBe("brief-unsent");
  expect(c("typed its brief nudge into the pane of LIN-5: its agent never answered", "stall")).toBe("brief-unsent");
  expect(c("something no pattern knows")).toBe("unknown");
  expect(c("the project is kept off this machine (local: false)")).toBeUndefined();
  expect(c("lock 'ui' is reserved for B5, skipped for locks 3 ticks")).toBeUndefined();
  expect(c("a paid key is not allowed: waits for your answer")).toBe("owner");
  expect(c("the project is paused, no step starts")).toBe("owner");
  expect(c("would start A", "start")).toBeUndefined();
});

test("a stall is recorded once past its limit, its remedy with the minutes from it, its end with the minutes it cost", () => {
  const state = { last: {}, roadmapErrors: [] } as unknown as State;
  const at = (m: number) => new Date(Date.UTC(2026, 5, 1, 10, m));
  const lock: Decision = { time: "", project: "p", step: "L2", kind: "skip", reason: "lock 'rules' is held by L1" };
  const remedy = () => "reminded LIN-1";
  // the lock limit is 240 minutes: before it, nothing is recorded
  expect(watchStalls("p", state, [{ ...lock }], [], at(0), remedy)).toEqual([]);
  expect(watchStalls("p", state, [{ ...lock }], [], at(239), remedy)).toEqual([]);
  const past = watchStalls("p", state, [{ ...lock }], [], at(240 + 1), remedy);
  expect(past.map((d) => [d.event, d.class, d.minutes])).toEqual([
    ["stall", "lock-held", undefined],
    ["remedy", "lock-held", 241],
  ]);
  expect(watchStalls("p", state, [{ ...lock }], [], at(250), remedy)).toEqual([]);
  const end = watchStalls("p", state, [], [], at(260), remedy);
  expect(end.map((d) => [d.event, d.minutes])).toEqual([["end", 260]]);
  expect(state.stalls).toEqual({});
});

test("every class is planted: recorded past its limit, remedied with minutes, ended with the minutes it cost", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 5, 1, 10, 0) + m * MIN);
  for (const [cls, info] of Object.entries(CLASS_INFO)) {
    const state = { last: {}, roadmapErrors: [] } as unknown as State;
    const o: Observation = { key: "X", class: cls as Observation["class"], evidence: `planted ${cls}`, since: at(0).getTime() };
    if (info.limit > 0) expect(watchStalls("p", state, [], [o], at(info.limit - 1), () => "fixed")).toEqual([]);
    const past = watchStalls("p", state, [], [o], at(info.limit + 1), () => "fixed");
    expect(past.map((d) => [d.event, d.class])).toEqual([
      ["stall", cls],
      ["remedy", cls],
    ]);
    const end = watchStalls("p", state, [], [], at(info.limit + 5), () => "fixed");
    expect(end.map((d) => [d.event, d.class, d.minutes])).toEqual([["end", cls, info.limit + 5]]);
  }
});

test("a stall seen by a task's own state counts from when it began", () => {
  const state = { last: {}, roadmapErrors: [] } as unknown as State;
  const o: Observation = { key: "LIN-5", class: "no-sign-of-life", evidence: "LIN-5: may be stuck", since: Date.UTC(2026, 5, 1, 9, 40) };
  const out = watchStalls("p", state, [], [o], new Date(Date.UTC(2026, 5, 1, 10, 0)));
  expect(out[0]).toMatchObject({ event: "stall", class: "no-sign-of-life", since: "2026-06-01T09:40:00.000Z" });
  const rung: Decision = { time: "", project: "p", step: "LIN-5", kind: "stall", reason: "rung 1: told LIN-5 it may be stuck" };
  watchStalls("p", state, [rung], [o], new Date(Date.UTC(2026, 5, 1, 10, 5)));
  expect(rung).toMatchObject({ class: "no-sign-of-life", event: "remedy", minutes: 25 });
});

test("a Paused project starts none of its steps, and that is no stall; Running again, the step starts", () => {
  const t = setup([]);
  const settings = JSON.parse(readFileSync(t.settingsFile, "utf8"));
  writeFileSync(t.settingsFile, JSON.stringify({ ...settings, paused: true }));
  expect(t.step(0).map((d) => d.reason)).toContain("the project is paused, no step starts");
  t.step(3 * 60 * MIN);
  expect(t.adds).toEqual([]);
  expect(t.decisions().some((d) => d.event === "stall")).toBe(false);
  writeFileSync(t.settingsFile, JSON.stringify(settings));
  t.step(MIN);
  expect(t.adds.map((a) => a[0])).toEqual(["A Alpha"]);
});

test("old decisions rotate to the archive once a day and are still read back", async () => {
  const { rotateDecisions, readDecisionsSince } = await import("../src/stall-class.ts");
  const dir = scratchDir("rotate");
  const file = join(dir, "decisions.jsonl");
  const now = new Date("2026-11-01T12:00:00Z");
  const at = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const lines = [200, 120, 95, 30, 1].map((d, i) => JSON.stringify({ time: at(d), project: "p", step: `T${i}`, kind: "stall", reason: "r" }));
  writeFileSync(file, `${lines.join("\n")}\n`);
  expect(rotateDecisions(file, now)).toBe(3);
  expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(2);
  expect(rotateDecisions(file, now)).toBe(0);
  expect(readDecisionsSince(file, now.getTime() - 40 * 86_400_000).map((d) => d.step)).toEqual(["T3", "T4"]);
  expect(readDecisionsSince(file, now.getTime() - 130 * 86_400_000).map((d) => d.step)).toEqual(["T1", "T2", "T3", "T4"]);
  expect(readDecisionsSince(file, 0).map((d) => d.step)).toEqual(["T0", "T1", "T2", "T3", "T4"]);
});

test("a step's task holds its locks by the rules' record, never by a title", () => {
  const steps = [{ id: "A", title: "Alpha", phase: "p", after: ["none"], fields: {} }] as unknown as Step[];
  const titled = [{ id: "LIN-9", title: "A and B next", status: "need" }] as Task[];
  expect(stepStatuses(steps, new Set(), titled, {})[0]?.state).toBe("ready");
  expect(stepStatuses(steps, new Set(), titled, { "LIN-9": "A" })[0]?.state).toBe("work");
});

test("an unproven step is no stall: the done-when text gets no class", () => {
  const reason = `L13 is merged, unproven: Lineclear's checkStalls posts a "may be stuck" card after 20 min with no sign of life.`;
  expect(classify({ kind: "skip", reason })).toBeUndefined();
});

test("the loop cuts decisions.jsonl once a day by its own day mark", () => {
  const t = setup();
  t.step(0);
  t.step(MIN);
  const mark = join(dirname(decisionsPath(t.env)), "decisions-cut-day");
  expect(readFileSync(mark, "utf8").trim()).toBe("2026-06-01");
  t.jump(24 * 60 * MIN);
  expect(readFileSync(mark, "utf8").trim()).toBe("2026-06-02");
  expect(existsSync(join(dirname(decisionsPath(t.env)), "stalls-daily.jsonl"))).toBe(false);
});
