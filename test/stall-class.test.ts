import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decisionsPath, tick, type Decision, type State } from "../src/rules.ts";
import { CLASS_INFO, classify, stallsMain, summarize, watchStalls, type Observation } from "../src/stall-class.ts";
import { DAY_CAP, fileFixes, fileFixNow, readFixes } from "../src/self-fix.ts";
import { recordRun } from "../src/check-runs.ts";
import { fileOutsideFixes } from "../src/outside-fix.ts";
import { readSettings } from "../src/project.ts";
import { stepStatuses, type Step, type Task } from "../src/roadmap.ts";
import { stallsOf } from "../src/stall-ladder.ts";
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

test("a loop that was away for over 30 minutes records a coordinator-gone stall, its remedy and its end", () => {
  const t = setup();
  t.jump(0);
  t.jump(5 * MIN);
  t.jump(60 * MIN);
  t.jump(MIN);
  const gone = t
    .decisions()
    .filter((d) => d.class === "coordinator-gone" && d.event !== undefined)
    .map((d) => [d.event, d.minutes]);
  expect(gone).toEqual([
    ["stall", undefined],
    ["remedy", 60],
    ["end", 61],
  ]);
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

test("the summary sums stalls and minutes by class, open ones until now, and the median minutes to a remedy", () => {
  const d = (time: string, cls: string, event: string, step: string, extra: object = {}) =>
    ({ time, project: "p", step, kind: "stall", class: cls, event, reason: "r", ...extra }) as Decision;
  const ds = [
    d("2026-06-01T10:00:00Z", "no-room", "stall", "L1", { since: "2026-06-01T08:00:00Z" }),
    d("2026-06-01T10:10:00Z", "no-room", "remedy", "L1", { minutes: 130 }),
    d("2026-06-01T11:00:00Z", "no-room", "end", "L1", { minutes: 180 }),
    d("2026-06-01T11:00:00Z", "signed-out", "stall", "LIN-2"),
  ];
  const s = summarize(ds, new Date("2026-06-01T09:00:00Z"), new Date("2026-06-01T12:00:00Z"));
  // no-room counts from the window's start: 09:00 to 11:00
  expect(s.classes["no-room"]).toEqual({ stalls: 1, minutes: 120, toRemedy: 130 });
  expect(s.classes["signed-out"]).toEqual({ stalls: 1, minutes: 60, toRemedy: null });
  expect([s.stalls, s.minutes]).toEqual([2, 180]);
});

test("a task whose step is merged is closed by its remedy, and lineclear stalls shows it", () => {
  const t = setup([{ id: "LIN-5", title: "A Alpha", status: "need" }], [{ subject: "A Alpha", body: "Step: A" }]);
  t.step(0);
  expect(t.log).toEqual([]);
  t.step(31 * MIN);
  expect(t.log).toEqual(["close LIN-5"]);
  const lines = t
    .decisions()
    .filter((d) => d.class === "idle-after-done")
    .map((d) => d.event);
  expect(lines).toEqual(["stall", "remedy"]);
  const out: string[] = [];
  expect(stallsMain([], (l) => out.push(l), decisionsPath(t.env), t.clock.at)).toBe(0);
  expect(out[0]).toContain("1 stall");
  expect(out[1]).toContain("idle after done");
  expect(stallsMain(["--bogus"], () => {}, decisionsPath(t.env))).toBe(2);
});

test("a revive loop is told once to carry on, not revived again", () => {
  const t = setup([{ id: "LIN-5", title: "A Alpha", status: "need" }]);
  t.world.chatCards = () => [{ id: "c1", task: "LIN-5", at: t.clock.at.getTime(), text: "Lineclear couldn't start it again" }];
  t.step(0);
  t.step(10 * MIN);
  expect(t.log.filter((l) => l.startsWith("tell LIN-5 Your agent was found waiting"))).toHaveLength(1);
  expect(
    t
      .decisions()
      .filter((d) => d.class === "revive-loop")
      .map((d) => d.event),
  ).toEqual(["stall", "remedy"]);
});

test("a held lock reminds the task that holds it, once", () => {
  const t = setup([{ id: "LIN-5", title: "A Alpha", status: "work" }]);
  const settings = readSettings("demo", t.env);
  if (typeof settings === "string") throw new Error(settings);
  const state: State = { healthFailures: 0, stopped: false, roadmapErrors: [], last: {}, ladder: {}, models: {}, handed: [], taskSteps: { "LIN-5": "A" } };
  const tasks = [{ id: "LIN-5", title: "A Alpha", status: "work" }] as Task[];
  const made: Decision[] = [];
  const tickAt = (min: number) => {
    t.clock.at = new Date(Date.parse("2026-06-01T10:00:00Z") + min * MIN);
    const held: Decision = { time: "", project: "demo", step: "B", kind: "skip", reason: "lock 'rules' is held by A" };
    made.push(...stallsOf("demo", settings, t.world, state, [held], { tasks }, false, t.env));
  };
  for (const min of [0, 29, 58, 87, 116, 145, 174, 203, 232, 261, 290]) tickAt(min);
  expect(t.log.filter((l) => l.startsWith("tell LIN-5 Another step waits for a lock"))).toHaveLength(1);
  expect(made.filter((d) => d.class === "lock-held" && d.event !== undefined).map((d) => d.event)).toEqual(["stall", "remedy"]);
});

test("a merge that stays queued is a head-of-line stall, and after two hours a lost merge told to run again", () => {
  const t = setup([{ id: "LIN-7", title: "A Alpha", status: "merging" }], [{ subject: "A Alpha", body: "Step: A" }]);
  t.step(0);
  t.step(10 * MIN);
  const queued = () =>
    t
      .decisions()
      .filter((d) => d.class === "head-of-line")
      .map((d) => d.event);
  expect(existsSync(decisionsPath(t.env)) ? queued() : []).toEqual([]);
  t.step(31 * MIN);
  expect(queued()).toEqual(["stall"]);
  // two hours on, its result counts as dropped: the queued stall ends and the task is told to merge again
  t.step(121 * MIN);
  expect(queued()).toEqual(["stall", "end"]);
  expect(
    t
      .decisions()
      .filter((d) => d.class === "merge-lost")
      .map((d) => d.event),
  ).toEqual(["stall", "remedy"]);
  expect(t.log.some((l) => l.startsWith("tell LIN-7 Your merge has been queued"))).toBe(true);
});

test("a planted new stall files exactly one fix, however many ticks see it", () => {
  const t = setup();
  // a reason no class names, on every tick, as a skip a world call gives
  t.world.maxTasks = () => {
    throw new Error("unplanted");
  };
  const planted = (now: Date): Decision => ({
    time: now.toISOString(),
    project: "demo",
    step: "A",
    kind: "skip",
    class: "unknown",
    event: "stall",
    reason: "stall unknown: a reason no class names",
  });
  for (let i = 0; i < 20; i++) {
    t.clock.at = new Date(t.clock.at.getTime() + 10 * MIN);
    const d = planted(t.clock.at);
    writeFileSync(decisionsPath(t.env), `${JSON.stringify(d)}\n`, { flag: "a" });
    fileFixes(t.world, decisionsPath(t.env), [d], t.env);
  }
  expect(t.adds.map((a) => a[0])).toEqual(["Plan: fix unknown"]);
  expect(t.adds[0]?.[1]).toContain("a reason no class names");
  expect(readFixes(t.env).unknown?.title).toBe("Plan: fix unknown");
});

/** One stall of `cls` at `step`, written and handed to fileFixes; the clock moves on a minute. */
function stallOnce(t: ReturnType<typeof setup>, cls: string, step: string) {
  const d = { time: t.clock.at.toISOString(), project: "demo", step, kind: "stall", class: cls, event: "stall", reason: `stall ${cls}: x` } as Decision;
  writeFileSync(decisionsPath(t.env), `${JSON.stringify(d)}\n`, { flag: "a" });
  t.clock.at = new Date(t.clock.at.getTime() + MIN);
  return fileFixes(t.world, decisionsPath(t.env), [d], t.env);
}

test("a known class files its fix on its second stall in 24 hours, one per class, and again after the fix closes", () => {
  const t = setup();
  const stall = (cls: string, step: string) => stallOnce(t, cls, step);
  expect(stall("signed-out", "LIN-1")).toEqual([]);
  expect(stall("signed-out", "LIN-2").map((d) => d.kind)).toEqual(["start"]);
  expect(stall("signed-out", "LIN-3")).toEqual([]);
  expect(stall("no-room", "L1")).toEqual([]);
  expect(t.adds.map((a) => a[0])).toEqual(["Plan: fix signed out"]);
  // the planner's task is done: the class may be filed again, by stalls after that
  t.tasks.list = t.tasks.list.map((x) => (x.title === "Plan: fix signed out" ? { ...x, status: "done" } : x));
  expect(stall("lock-held", "L2")).toEqual([]);
  expect(stall("signed-out", "LIN-4")).toEqual([]);
  expect(stall("signed-out", "LIN-5").map((d) => d.kind)).toEqual(["start"]);
  expect(t.adds).toHaveLength(2);
});

test("a hard cap: at most 3 fixes filed in 24 hours in all, however many classes stall", () => {
  const t = setup();
  const stall = (cls: string, step: string) => stallOnce(t, cls, step);
  const classes = ["signed-out", "account-full", "revive-loop", "lock-held", "no-room"];
  for (const c of classes) for (const n of [1, 2]) stall(c, `${c}-${n}`);
  expect(t.adds).toHaveLength(3);
  // the fourth class waits and says why; closing a fix does not lift the cap
  expect(stall("lock-held", "x").map((d) => d.reason)).toEqual([
    `a fix for the stall class 'lock-held' waits: ${DAY_CAP} fixes were filed in the last 24 hours, the most a day`,
  ]);
  t.tasks.list = t.tasks.list.map((x) => (x.title.startsWith("Plan: fix") ? { ...x, status: "done" } : x));
  stall("signed-out", "again-1");
  stall("signed-out", "again-2");
  expect(t.adds).toHaveLength(3);
  expect(fileFixNow(t.world, "main-red", ["track broke"], t.env)).toContain("the most a day");
  // a day after the first ones, there is room again
  t.clock.at = new Date(t.clock.at.getTime() + 24 * 60 * MIN);
  stall("lock-held", "later-1");
  expect(stall("lock-held", "later-2").map((d) => d.kind)).toEqual(["start"]);
  expect(t.adds).toHaveLength(4);
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

test("a task titled with a merged step's id that the rules did not start is no idle-after-done, and a started one with unmerged commits stays open", () => {
  const t = setup(
    [
      { id: "LIN-198", title: "A and B next after 0.1", status: "need" },
      { id: "LIN-5", title: "A Alpha", status: "need" },
    ],
    [{ subject: "A Alpha", body: "Step: A" }],
  );
  // LIN-198 is the owner's own task: only LIN-5 was started by the rules
  t.world.commitsAhead = () => 2;
  t.step(0);
  t.step(31 * MIN);
  expect(t.log.filter((l) => l.startsWith("close"))).toEqual([]);
  const idle = t.decisions().filter((d) => d.class === "idle-after-done");
  expect(idle.map((d) => `${d.step}:${d.event}`)).toEqual(["LIN-5:stall"]);
});

test("every held lock gets a remedy by what its holder is doing, once", () => {
  const cases: [string, T, string | undefined][] = [
    ["work", { id: "LIN-5", title: "L130 Alpha", status: "work" }, "tell LIN-5 Another step waits for a lock"],
    ["queued", { id: "LIN-5", title: "L130 Alpha", status: "queued" }, "tell LIN-5 Another step waits for a lock"],
    ["sleeping", { id: "LIN-5", title: "L130 Alpha", status: "sleep" }, "tell LIN-5 Another step waits for a lock"],
    ["need, no question", { id: "LIN-5", title: "L130 Alpha", status: "need", sub: "Waits for your reply" }, "tell LIN-5 Another step waits for a lock"],
    ["need, open question", { id: "LIN-5", title: "L130 Alpha", status: "need", sub: "Question: which colour?" }, undefined],
    ["merged", { id: "LIN-5", title: "L130 Alpha", status: "need", sub: "Waits for your reply" }, "close LIN-5"],
  ];
  for (const [name, task, action] of cases) {
    const t = setup([task]);
    const settings = readSettings("demo", t.env);
    if (typeof settings === "string") throw new Error(settings);
    const state: State = { healthFailures: 0, stopped: false, roadmapErrors: [], last: {}, ladder: {}, models: {}, handed: [], taskSteps: { "LIN-5": "L130" } };
    const done = new Set(name === "merged" ? ["L130"] : []);
    const made: Decision[] = [];
    const tickAt = (min: number, st: State) => {
      t.clock.at = new Date(Date.parse("2026-06-01T10:00:00Z") + min * MIN);
      const held: Decision = { time: "", project: "demo", step: "L131", kind: "skip", reason: "lock 'server' is held by L130" };
      made.push(...stallsOf("demo", settings, t.world, st, [held], { tasks: [task as Task], done, stepOf: () => "L130" }, false, t.env));
    };
    tickAt(0, state);
    tickAt(241, state);
    tickAt(300, state);
    tickAt(360, JSON.parse(JSON.stringify(state)));
    // a merged step's idle task is also closed by its own stall class: one close either way
    const acts = [...new Set(t.log.filter((l) => /^(tell|close) /.test(l)))];
    expect(acts, name).toHaveLength(action ? 1 : 0);
    if (action) expect(acts[0]?.startsWith(action), name).toBe(true);
    const remedies = made.filter((d) => d.class === "lock-held" && d.event === "remedy");
    expect(remedies, name).toHaveLength(1);
    if (!action) expect(remedies[0]?.reason, name).toContain("waits for the owner");
  }
});

test("a test red outside the change gets one Fix task, however many runs name it, and another after it closes", () => {
  const t = setup();
  const run = (outside: string[]) =>
    recordRun(
      {
        at: t.clock.at.getTime(),
        repo: t.env.LINECLEAR_HOME ? join(t.env.LINECLEAR_HOME, "..") : "",
        tier: "merge",
        command: "check",
        commit: "c",
        branch: "b",
        dirty: false,
        seconds: 1,
        load: 0,
        cores: 8,
        ok: false,
        failed: outside,
        outside,
        group: "g",
      },
      t.env,
    );
  run(["a flaky test"]);
  run(["a flaky test"]);
  expect(fileOutsideFixes(t.world, t.env)).toEqual(["Fix: a flaky test"]);
  expect(fileOutsideFixes(t.world, t.env)).toEqual([]);
  expect(t.adds.map((a) => a[0])).toEqual(["Fix: a flaky test"]);
  t.tasks.list = t.tasks.list.map((x) => (x.title === "Fix: a flaky test" ? { ...x, status: "done" } : x));
  expect(fileOutsideFixes(t.world, t.env)).toEqual([]);
  t.clock.at = new Date(t.clock.at.getTime() + 60_000);
  run(["a flaky test"]);
  expect(fileOutsideFixes(t.world, t.env)).toEqual(["Fix: a flaky test"]);
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
