import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decisionsPath } from "../pi/config.ts";
import { apiP95, recordLatency } from "../src/api-latency.ts";
import { recordRun } from "../src/check-runs.ts";
import { alarms, type Facts, LIMITS, wasteLine } from "../src/waste.ts";
import { docsOnly, forkCount, readFacts } from "../src/waste-facts.ts";
import { readFixes } from "../src/self-fix.ts";
import { wasteLines, watchWaste } from "../src/waste-watch.ts";
import { fakeWorld, scratch } from "./fake-world.ts";

const scratchDir = scratch();
const MIN = 60_000;

const calm: Facts = {
  starts: { "p T1": 2 },
  ended: { total: 10, unmerged: 2 },
  lockSkips: { "p rules": 60 },
  stepSkips: { "p T1": 9 },
  freeSlots: 2,
  merge: { runs: 10, red: 3, redNoTest: 1 },
  forksPerSecond: 100,
  apiP95Ms: 3000,
  tokensPerStep: 15_000_000,
  docsOnlyRuns: [{ branch: "work/1-x", seconds: 120 }],
};

const ids = (f: Facts) => alarms(f).map((a) => a.id);

test("facts exactly at every limit raise no alarm", () => {
  expect(alarms(calm)).toEqual([]);
});

test("every limit has a reason", () => {
  for (const l of Object.values(LIMITS)) expect(l.reason.length).toBeGreaterThan(20);
});

test("starts: a step started three times in 24 h", () => {
  const [a] = alarms({ ...calm, starts: { "ledger T2": 146, "p T1": 1 } });
  if (!a) throw new Error("no alarm");
  expect(a.id).toBe("starts");
  expect(wasteLine(a)).toBe("Waste: step started again and again, 146 starts of ledger T2");
  expect(ids({ ...calm, starts: { x: 4 } })).toEqual(["starts"]);
});

test("unmerged: over 20 % of ended tasks, and not on a handful", () => {
  expect(ids({ ...calm, ended: { total: 10, unmerged: 3 } })).toEqual(["unmerged"]);
  expect(ids({ ...calm, ended: { total: 4, unmerged: 4 } })).toEqual([]);
});

test("lock skips: one lock over 60 an hour", () => {
  expect(ids({ ...calm, lockSkips: { "p rules": 61 } })).toEqual(["lockSkips"]);
});

test("ready steps wait while a slot is free, not while none is", () => {
  expect(ids({ ...calm, stepSkips: { "p T1": 10 } })).toEqual(["idleSlots"]);
  expect(ids({ ...calm, stepSkips: { "p T1": 10 }, freeSlots: 0 })).toEqual([]);
});

test("merge checks: red share over 30 % of at least 5 runs", () => {
  expect(ids({ ...calm, merge: { runs: 10, red: 4, redNoTest: 0 } })).toEqual(["redMerges"]);
  expect(ids({ ...calm, merge: { runs: 4, red: 4, redNoTest: 0 } })).toEqual([]);
});

test("red runs that name no test: two in 24 h", () => {
  expect(ids({ ...calm, merge: { runs: 10, red: 2, redNoTest: 2 } })).toEqual(["redNoTest"]);
});

test("forks per second and the API's p95", () => {
  expect(ids({ ...calm, forksPerSecond: 101 })).toEqual(["forks"]);
  expect(ids({ ...calm, apiP95Ms: 8000 })).toEqual(["apiSlow"]);
  expect(ids({ ...calm, forksPerSecond: undefined, apiP95Ms: undefined })).toEqual([]);
});

test("tokens per merged step", () => {
  expect(ids({ ...calm, tokensPerStep: 20_000_000 })).toEqual(["tokens"]);
  expect(ids({ ...calm, tokensPerStep: null })).toEqual([]);
});

test("scope: a docs-only change checked for over 120 s", () => {
  expect(ids({ ...calm, docsOnlyRuns: [{ branch: "work/9-roadmap", seconds: 900 }] })).toEqual(["scope"]);
  expect(docsOnly(["docs/ROADMAP.md"])).toBe(true);
  expect(docsOnly(["docs/a.md", "src/x.ts"])).toBe(false);
  expect(docsOnly([])).toBe(false);
});

test("the fork count is read from /proc/stat's processes line", () => {
  expect(forkCount(() => "cpu 1 2 3\nprocesses 4242\nprocs_running 1\n")).toBe(4242);
  expect(forkCount(() => "cpu 1\n")).toBeUndefined();
});

test("the API's p95 is the median of the minutes' p95s, and needs three minutes", () => {
  const dir = scratchDir("waste-api");
  const config = { LINECLEAR_CONFIG: dir };
  const t0 = Date.parse("2026-06-01T10:00:00Z");
  for (let m = 0; m < 4; m++) for (let i = 0; i < 20; i++) recordLatency(m === 1 ? 20_000 : 500, config, t0 + m * MIN + i);
  recordLatency(500, config, t0 + 4 * MIN);
  expect(apiP95(config, t0 + 5 * MIN)).toBe(500);
  expect(apiP95(config, t0 + 60 * MIN)).toBeUndefined();
});

/** One project that is Lineclear's own, in a scratch config and board folder. */
function setup() {
  const dir = scratchDir("waste");
  const config = join(dir, "config");
  const home = join(dir, "home");
  mkdirSync(join(config, "projects", "demo"), { recursive: true });
  mkdirSync(home, { recursive: true });
  const models = { worker: ["anthropic/claude-sonnet-5-5"], reviewer: ["anthropic/claude-opus-5-5"], planner: ["anthropic/claude-opus-5-5"] };
  writeFileSync(join(config, "projects", "demo", "settings.json"), JSON.stringify({ repo: dir, space: "demo", check: "true", self: true, models }));
  const scope = { ...process.env, LINECLEAR_CONFIG: config, LINECLEAR_HOME: home, XDG_CACHE_HOME: join(dir, "cache"), PI_CODING_AGENT_DIR: join(dir, "pi") };
  const w = fakeWorld(scope, [], "# Roadmap\n");
  return { dir, home, env: scope, now: w.clock.at.getTime(), ...w };
}

test("the facts come from decisions, tasks and check runs", () => {
  const t = setup();
  const at = (ago: number) => new Date(t.now - ago).toISOString();
  const lines = [
    ...[1, 2, 3].map((i) => ({ time: at(i * MIN), project: "demo", step: "T2", kind: "start", reason: "ready" })),
    ...[1, 2].map((i) => ({ time: at(i * MIN), project: "demo", step: "T3", kind: "skip", reason: "lock 'tools' is held by T1" })),
    { time: at(3 * 3_600_000), project: "demo", step: "T3", kind: "skip", reason: "lock 'tools' is held by T1" },
  ];
  writeFileSync(decisionsPath(t.env), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  const task = (id: string, merged: boolean) => ({ id, doneAt: t.now - MIN, merged });
  writeFileSync(
    join(t.home, "tasks.json"),
    JSON.stringify({ tasks: [task("A", true), task("B", false), task("C", false), { id: "D", doneAt: t.now - 3 * 86_400_000 }] }),
  );
  const run = (ok: boolean, failed: string[]) =>
    recordRun(
      {
        at: t.now - MIN,
        repo: t.dir,
        tier: "merge",
        command: "bun run check",
        commit: "0".repeat(40),
        branch: "work/1",
        dirty: false,
        seconds: 5,
        load: 1,
        cores: 4,
        ok,
        failed,
        group: "g",
      },
      t.env,
    );
  run(true, []);
  run(false, []);
  run(false, ["a test"]);
  const f = readFacts(t.world, t.env, t.now);
  expect(f.starts).toEqual({ "demo T2": 3 });
  expect(f.lockSkips).toEqual({ "demo tools": 2 });
  expect(f.stepSkips).toEqual({ "demo T3": 2 });
  expect(f.ended).toEqual({ total: 3, unmerged: 2 });
  expect(f.merge).toEqual({ runs: 3, red: 2, redNoTest: 1 });
});

test("an alarm files one Fix task with its numbers and shows on Home, however many looks see it", () => {
  const t = setup();
  const bad = { ...calm, starts: { "demo T2": 146 } };
  for (let i = 0; i < 5; i++) {
    t.clock.at = new Date(t.clock.at.getTime() + 11 * MIN);
    watchWaste(t.world, t.env, bad);
  }
  expect(t.adds.map((a) => a[0])).toEqual(["Fix waste: starts"]);
  expect(t.adds[0]?.[1]).toContain("demo T2: 146 starts in 24 h");
  expect(t.adds[0]?.[1]).toContain(LIMITS.starts.reason);
  expect(wasteLines(t.env, t.clock.at.getTime())).toEqual(["Waste: step started again and again, 146 starts of demo T2"]);
  expect(readFixes(t.env)["waste:starts"]?.title).toBe("Fix waste: starts");
});

test("the day cap holds, and a look within 10 minutes of the last does nothing", () => {
  const t = setup();
  const worst: Facts = { ...calm, starts: { a: 9 }, ended: { total: 10, unmerged: 9 }, lockSkips: { x: 99 }, forksPerSecond: 500, apiP95Ms: 9000 };
  const d = watchWaste(t.world, t.env, worst);
  expect(t.adds).toHaveLength(3);
  expect(d.some((x) => x.kind === "skip" && x.reason.includes("waits"))).toBe(true);
  expect(watchWaste(t.world, t.env)).toEqual([]);
});

test("a calm look files nothing and clears Home", () => {
  const t = setup();
  watchWaste(t.world, t.env, { ...calm, starts: { a: 9 } });
  t.clock.at = new Date(t.clock.at.getTime() + 11 * MIN);
  watchWaste(t.world, t.env, calm);
  expect(wasteLines(t.env, t.clock.at.getTime())).toEqual([]);
});
