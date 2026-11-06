// The contract of the check tiers: tiers with budgets, the check log and flake quarantine.
import { expect, test } from "bun:test";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CheckRun,
  EVERY_STEP_RAN,
  failedGate,
  failedTests,
  flakeFixDue,
  onlyQuarantined,
  quarantined,
  quarantineReport,
  readRuns,
  recordRun,
  refusedMergeBranches,
  runLog,
  whereRun,
} from "../../src/check-runs.ts";
import { recordPassed, splitCached } from "../../scripts/result-cache.ts";
import { checkTier } from "../../src/check-tier.ts";
import { proveStep } from "../../src/doneproof-run.ts";
import { checkRoadmap, type Step } from "../../src/roadmap.ts";
import { checkSteps } from "../../src/stepcheck.ts";
import { machineRunLine, readWork, recordWork, runsPerMachine, strayRuns } from "../../src/task-work.ts";
import { checkLine, inTurn, laneInLine, lineOf, machineOf } from "../../server/server/live/engine/check-queue.ts";
import { check } from "../../src/waits.ts";
import { changeSettings, proposeTiers, readSettings, type Settings, tiersOf } from "../../src/project.ts";
import { sh, tmp } from "../helpers.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-01T12:00:00Z");

function project(scripts: Record<string, string> = { check: "bun test", "types:fast": "tsc", coverage: "bun test --coverage" }) {
  const root = tmp("checks");
  const repo = join(root, "repo");
  mkdirSync(repo);
  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts }));
  sh(["git", "init", "-q", "-b", "main", repo]);
  const config = join(root, "config");
  mkdirSync(join(config, "projects", "app"), { recursive: true });
  writeFileSync(
    join(config, "projects", "app", "settings.json"),
    JSON.stringify({ repo, space: "app", check: "bun run check", models: { worker: [], reviewer: [], planner: [] } }),
  );
  const env = { ...process.env, LINECLEAR_CONFIG: config };
  const settings = () => readSettings("app", env) as Settings;
  return { repo, env, settings };
}

const run = (repo: string, o: Partial<CheckRun>): Omit<CheckRun, "kind"> => ({
  at: NOW - DAY,
  repo,
  tier: "merge",
  command: "bun run check",
  commit: "c1",
  branch: "work/1",
  dirty: false,
  seconds: 100,
  load: 1,
  cores: 8,
  ok: true,
  failed: [],
  group: `g${Math.random()}`,
  ...o,
});

test("proposeTiers puts fast scripts in inner, the check in merge and heavy ones in heavy", () => {
  const p = project();
  expect(proposeTiers(p.repo, "bun run check")).toEqual({
    inner: { commands: ["bun run types:fast"], budgetS: 30 },
    merge: { commands: ["bun run check"], budgetS: 180 },
    heavy: { commands: ["bun run coverage"], budgetS: 3600 },
  });
});

test("tiers the owner did not set follow the check: a changed check is the merge tier", () => {
  const p = project();
  expect(changeSettings("app", { tiers: { inner: { commands: ["bun run types:fast"] } } }, p.env)).not.toBeString();
  expect(changeSettings("app", { check: "make check" }, p.env)).not.toBeString();
  expect(p.settings().tiers).toEqual({ inner: { commands: ["bun run types:fast"] } });
  expect(tiersOf(p.settings()).merge.commands).toEqual(["make check"]);
  expect(changeSettings("app", { tiers: { merge: { commands: [] } } }, p.env)).toBe("the merge tier needs a command");
});

test("a flake is quarantined, counts as passed, and leaves after its release", async () => {
  const p = project();
  const output = "(fail) login > remembers [12.00ms]\n 1 fail\n";
  expect(failedTests(output)).toEqual(["login > remembers"]);
  recordRun(run(p.repo, { ok: false, failed: ["login > remembers"], at: NOW - 2 * DAY }), p.env);
  recordRun(run(p.repo, { at: NOW - DAY }), p.env);
  const q = quarantined(p.repo, p.env);
  expect([...q.keys()]).toEqual(["login > remembers"]);
  const passes = (out: string, command = "bun test", code = 1) => onlyQuarantined(command, out, code, failedTests(out), q);
  expect(passes(output)).toBe(true);
  expect(passes(`${output}check: types failed\n`, "bun run check")).toBe(false);
  // a check of several steps passes only once it printed that every step ran, and never as a chain
  expect(passes(output, "bun run check")).toBe(false);
  expect(passes(`${output}check: tests failed\n${EVERY_STEP_RAN}\n`, "bun run check")).toBe(true);
  expect(passes(`${output}check: tests failed\n${EVERY_STEP_RAN}\ncheck: the tests left 1 folder behind: x\n`, "bun run check")).toBe(false);
  expect(passes(`${output}check: tests 2/4 failed\ncheck: steps, slowest first (load factor 1.00)\n${EVERY_STEP_RAN}\n`, "bun run check")).toBe(true);
  expect(passes(output, "bun test && bun run lint")).toBe(false);
  // cut short: no count, a timeout, or an error outside any test
  expect(passes("(fail) login > remembers [12.00ms]\n")).toBe(false);
  expect(passes(output, "bun test", 124)).toBe(false);
  expect(passes(`${output} 1 error\n`)).toBe(false);
  const out: string[] = [];
  expect(
    await checkTier(
      ["--release", "login > remembers"],
      p.settings(),
      (l) => out.push(l),
      p.env,
      p.repo,
      async () => 0,
    ),
  ).toBe(0);
  expect(quarantined(p.repo, p.env).size).toBe(0);
});

test("quarantine knows a test by its file: the same name in another file still runs", () => {
  const p = project();
  const output = "a.test.ts:\n(fail) works [1.00ms]\nb.test.ts:\n(pass) works [1.00ms]\n 1 fail\n";
  expect(failedTests(output)).toEqual(["a.test.ts: works"]);
  recordRun(run(p.repo, { ok: false, failed: failedTests(output), at: NOW - 2 * DAY }), p.env);
  recordRun(run(p.repo, { at: NOW - DAY }), p.env);
  const q = quarantined(p.repo, p.env);
  expect([...q.keys()]).toEqual(["a.test.ts: works"]);
  expect(onlyQuarantined("bun test", output, 1, failedTests(output), q)).toBe(true);
  const other = "b.test.ts:\n(fail) works [1.00ms]\n 1 fail\n";
  expect(onlyQuarantined("bun test", other, 1, failedTests(other), q)).toBe(false);
});

test("quarantine plants a fail, a flake, a heal and a broken case", async () => {
  const p = project();
  const failRun = (at: number, commit: string, ...failed: string[]) => recordRun(run(p.repo, { ok: false, failed, at, commit }), p.env);
  const passRun = (at: number, commit: string) => recordRun(run(p.repo, { at, commit }), p.env);
  // fail: a test that fails on every run never passes, so it is never quarantined
  failRun(NOW, "c1", "a.test.ts: fail");
  failRun(NOW + 1, "c1", "a.test.ts: fail");
  expect(quarantined(p.repo, p.env).size).toBe(0);
  // flake: failed, then passed on the same commit
  failRun(NOW + 2, "c2", "a.test.ts: flake");
  passRun(NOW + 3, "c2");
  expect([...quarantined(p.repo, p.env).keys()]).toEqual(["a.test.ts: flake"]);
  expect(flakeFixDue(p.repo, p.env, NOW + 4)).toEqual([]);
  // a second flake within 24 hours is due a fix task
  failRun(NOW + 5, "c3", "a.test.ts: flake");
  passRun(NOW + 6, "c3");
  expect(flakeFixDue(p.repo, p.env, NOW + 7)).toEqual([{ test: "a.test.ts: flake", seen: 2 }]);
  expect(flakeFixDue(p.repo, p.env, NOW + 3 * DAY)).toEqual([]);
  // counts: clean runs and the failure that resets them
  for (let i = 0; i < 4; i++) passRun(NOW + 10 + i, "c4");
  expect(quarantineReport(p.repo, p.env)).toEqual(["lineclear check: in quarantine: a.test.ts: flake (2 flakes, 5 of 10 clean runs, 1 failed since)"]);
  recordRun(run(p.repo, { ok: false, quarantined: true, failed: ["a.test.ts: flake"], at: NOW + 20, commit: "c5" }), p.env);
  expect(quarantineReport(p.repo, p.env)[0]).toContain("0 of 10 clean runs, 2 failed since");
  // heal: 10 clean runs in a row release it
  for (let i = 0; i < 10; i++) passRun(NOW + 30 + i, "c6");
  expect(quarantined(p.repo, p.env).size).toBe(0);
  // broken: it fails on each run after its quarantine, so it leaves and blocks again
  failRun(NOW + 50, "c7", "b.test.ts: broken");
  passRun(NOW + 51, "c7");
  expect(quarantined(p.repo, p.env).has("b.test.ts: broken")).toBe(true);
  for (let i = 0; i < 3; i++) failRun(NOW + 60 + i, `c8${i}`, "b.test.ts: broken");
  expect(quarantined(p.repo, p.env).size).toBe(0);
  // intermittent: failures with a pass between them are not a broken test, and two failures before one pass are one flake
  failRun(NOW + 70, "d1", "c.test.ts: odd");
  failRun(NOW + 71, "d1", "c.test.ts: odd");
  passRun(NOW + 72, "d1");
  expect(quarantined(p.repo, p.env).get("c.test.ts: odd")?.flakes).toHaveLength(1);
  for (let i = 0; i < 2; i++) {
    failRun(NOW + 80 + 2 * i, `d2${i}`, "c.test.ts: odd");
    passRun(NOW + 81 + 2 * i, `d2${i}`);
  }
  expect(quarantined(p.repo, p.env).has("c.test.ts: odd")).toBe(true);
});

test("each command of a chained tier runs, so quarantine applies to every one", async () => {
  const p = project();
  expect(changeSettings("app", { tiers: { merge: { commands: ["one", "two"] } } }, p.env)).not.toBeString();
  const ran: string[] = [];
  const out: string[] = [];
  const code = await checkTier(
    ["--tier", "merge"],
    p.settings(),
    (l) => out.push(l),
    p.env,
    p.repo,
    async (c) => (ran.push(c), c === "one" ? 1 : 0),
  );
  // a quiet machine reruns the unnamed failure of "one", a loaded one does not: the rerun is not what this test is about
  expect([...new Set(ran)]).toEqual(["one", "two"]);
  expect(code).toBe(1);
});

test("a second flake of a test in a day files its fix task once", async () => {
  const p = project();
  const recent = Date.now();
  recordRun(run(p.repo, { ok: false, failed: ["a.test.ts: x"], at: recent - 5, commit: "c1" }), p.env);
  recordRun(run(p.repo, { at: recent - 4, commit: "c1" }), p.env);
  recordRun(run(p.repo, { ok: false, failed: ["a.test.ts: x"], at: recent - 3, commit: "c2" }), p.env);
  recordRun(run(p.repo, { at: recent - 2, commit: "c2" }), p.env);
  const filed: unknown[] = [];
  const file = (space: string, f: { file: string; test: string }, seen: number) => (filed.push([space, f, seen]), true);
  const once = () =>
    checkTier(
      ["--tier", "merge"],
      p.settings(),
      () => {},
      p.env,
      p.repo,
      async () => 0,
      undefined,
      undefined,
      file,
    );
  await once();
  await once();
  expect(filed).toEqual([["app", { file: "a.test.ts", test: "x" }, 2]]);
});

test("lineclear check runs a tier, records it, and refuses a third run of a commit that failed twice", async () => {
  const p = project();
  sh(["git", "-C", p.repo, "add", "-A"]);
  sh(["git", "-C", p.repo, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "x"]);
  const out: string[] = [];
  const failing = async () => 1;
  for (let i = 0; i < 2; i++) expect(await checkTier([], p.settings(), (l) => out.push(l), p.env, p.repo, failing)).toBe(1);
  let ran = 0;
  expect(
    await checkTier(
      [],
      p.settings(),
      (l) => out.push(l),
      p.env,
      p.repo,
      async () => {
        ran++;
        return 0;
      },
    ),
  ).toBe(1);
  expect(ran).toBe(0);
  expect(out.at(-1)).toContain("failed twice on this commit");
  expect(
    await checkTier(
      ["--tier", "inner"],
      p.settings(),
      (l) => out.push(l),
      p.env,
      p.repo,
      async () => 0,
    ),
  ).toBe(0);
});

test("lineclear check --changed leaves one line in the check log with its time, commit and load", async () => {
  const p = project({ check: "echo ok" });
  mkdirSync(join(p.repo, "scripts"));
  writeFileSync(join(p.repo, "scripts/check.ts"), "// takes --changed\n");
  sh(["git", "-C", p.repo, "add", "-A"]);
  sh(["git", "-C", p.repo, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "-m", "x"]);
  expect(await check(() => {}, p.env, { cwd: p.repo }, ["--changed"])).toBe(0);
  const runs = readRuns(p.repo, 0, p.env);
  expect(runs).toHaveLength(1);
  expect(runs[0]?.at).toBeGreaterThan(0);
  expect(runs[0]?.commit).toMatch(/^[0-9a-f]{7,}/);
  expect(runs[0]?.load).toBeGreaterThanOrEqual(0);
});

test("a run writes the load at its start to the log line", async () => {
  const p = project();
  expect(
    await checkTier(
      ["--tier", "inner"],
      p.settings(),
      () => {},
      p.env,
      p.repo,
      async () => 0,
      () => [6, 6, 6],
    ),
  ).toBe(0);
  const line = readFileSync(join(p.env.LINECLEAR_CONFIG ?? "", "check-runs.jsonl"), "utf8").trim();
  expect(JSON.parse(line).loadAtStart).toBe(6);
});

test("a run that waited behind another on one slot logs its wait, and a run that did not logs 0", async () => {
  const p = project({ check: "sleep 1" });
  const { env } = p;
  writeFileSync(join(env.LINECLEAR_CONFIG ?? "", "machine.json"), JSON.stringify({ checkSlots: 1, loadPerCore: 1e6 }));
  // the first run says it holds the slot, so the second certainly arrives behind it however loaded the machine is
  const held = join(env.LINECLEAR_CONFIG ?? "", "held");
  const go = (command: string) => check(() => {}, env, { cwd: p.repo, pollMs: 50 }, ["--tier", "merge", command]);
  const first = go(`touch ${held}; sleep 2`);
  while (!existsSync(held)) await Bun.sleep(20);
  expect(await Promise.all([first, go("sleep 0")])).toEqual([0, 0]);
  const [a, b] = readRuns(p.repo, 0, env).sort((x, y) => x.at - y.at);
  expect((a?.slotWaitMin ?? 1) * 60).toBeLessThan(1);
  expect((b?.slotWaitMin ?? 0) * 60).toBeGreaterThan(0.3);
  expect((b?.slotWaitMin ?? 0) * 60).toBeLessThanOrEqual((a?.seconds ?? 0) + 0.1);
});

test("on two cores one heavy run holds a slot at a time, and the lane's check starts before the agent checks still waiting", async () => {
  const p = project({ check: "true" });
  const env = { ...p.env, LINECLEAR_CORES: "2", LINECLEAR_TASK: "LIN-1" };
  writeFileSync(join(env.LINECLEAR_CONFIG ?? "", "machine.json"), JSON.stringify({ loadPerCore: 1e6 }));
  const log = join(env.LINECLEAR_CONFIG ?? "", "starts");
  const go = join(env.LINECLEAR_CONFIG ?? "", "go");
  // the first run holds its slot until the others are in line, so a slow machine cannot hand the slot to an agent before the lane waits for it
  const agent = (n: number) =>
    check(() => {}, env, { cwd: p.repo, pollMs: 20 }, [
      "--tier",
      "merge",
      `echo start-${n} >> ${log}; while [ ! -e ${go} ]; do sleep 0.05; done; sleep 0.2; echo end-${n} >> ${log}`,
    ]);
  const until = async (ready: () => boolean) => {
    while (!ready()) await Bun.sleep(10);
  };
  const first = agent(0);
  await until(() => existsSync(log));
  const waiting = [agent(1), agent(2), agent(3)];
  await until(() => checkLine(lineOf(p.repo, env), env).length === 4);
  const laneLine = `${machineOf(env)}@lane`;
  const lane = inTurn("lane", laneLine, async () => appendFileSync(log, "start-lane\nend-lane\n"), { env, pollMs: 200 });
  await until(() => laneInLine(laneLine, env));
  writeFileSync(go, "");
  expect(await Promise.all([first, ...waiting, lane])).toEqual([0, 0, 0, 0, undefined]);
  const events = readFileSync(log, "utf8").trim().split("\n");
  // each start is followed by its own end: no two runs overlap
  for (let i = 0; i < events.length; i += 2) expect(events[i]?.replace("start", "end")).toBe(events[i + 1]);
  expect(events.indexOf("start-lane")).toBeLessThan(Math.min(...[1, 2, 3].map((n) => events.indexOf(`start-${n}`))));
});

const quiet = () => [0, 0, 0];
const outcomes = (codes: [number, string][]) => {
  let n = 0;
  return async (_c: string, _t: string, hear: (text: string) => void) => {
    const [code, text] = codes[Math.min(n++, codes.length - 1)] ?? [0, ""];
    hear(text);
    return code;
  };
};

test("a run that timed out is rerun once on a quiet machine: it passes, no refusal is counted and the first log line says rerun", async () => {
  const p = project();
  const lines: string[] = [];
  const run = outcomes([
    [124, "check: tests timed out"],
    [0, "ok"],
  ]);
  expect(await checkTier([], p.settings(), (l) => lines.push(l), p.env, p.repo, run, quiet)).toBe(0);
  const runs = readRuns(p.repo, 0, p.env);
  expect(runs.map((r) => r.ok)).toEqual([false, true]);
  expect(refusedMergeBranches(runs)).toEqual([]);
  expect(runLog(p.repo, p.env)[0]).toContain("rerun");
});

test("a run that fails again with no name is held as unnamed with one refusal", async () => {
  const p = project();
  const lines: string[] = [];
  const run = outcomes([
    [1, "killed"],
    [1, "killed"],
  ]);
  expect(await checkTier([], p.settings(), (l) => lines.push(l), p.env, p.repo, run, quiet)).toBe(1);
  const runs = readRuns(p.repo, 0, p.env);
  expect(runs).toHaveLength(2);
  expect(refusedMergeBranches(runs)).toHaveLength(1);
  expect(lines.some((l) => l.includes("held, cause unnamed"))).toBe(true);
});

test("a run that names a failing test or gate is never rerun, and a loaded machine does not rerun", async () => {
  const p = project();
  const named = outcomes([
    [1, "(fail) a test\n 1 fail"],
    [0, "ok"],
  ]);
  expect(await checkTier([], p.settings(), () => {}, p.env, p.repo, named, quiet)).toBe(1);
  expect(readRuns(p.repo, 0, p.env)).toHaveLength(1);
  const q = project();
  expect(
    await checkTier(
      [],
      q.settings(),
      () => {},
      q.env,
      q.repo,
      outcomes([
        [124, ""],
        [0, ""],
      ]),
      () => [1e6, 1e6, 1e6],
    ),
  ).toBe(124);
  expect(readRuns(q.repo, 0, q.env)).toHaveLength(1);
});

test("a run that fails in a gate and names no test records the gate and its first line", async () => {
  const out = "no tests here\ncheck: gates failed: src/a.ts:3 lint/style: unused import\ncheck: tests 2/4 failed\ncheck: every step ran";
  expect(failedGate(out)).toEqual({ step: "gates", line: "src/a.ts:3 lint/style: unused import" });
  expect(failedGate("check: tests failed\ncheck: passed")).toBeUndefined();
  const p = project();
  const say = async (_c: string, _t: string, hear: (text: string) => void) => {
    hear(out);
    return 1;
  };
  expect(await checkTier([], p.settings(), () => {}, p.env, p.repo, say)).toBe(1);
  expect(readRuns(p.settings().repo, 0, p.env).at(-1)?.gate).toEqual({ step: "gates", line: "src/a.ts:3 lint/style: unused import" });
});

test("check --log prints the short commit, time, wait and start load of each logged run", async () => {
  const p = project();
  const commits = ["aaaaaaa1111", "bbbbbbb2222", "ccccccc3333"];
  commits.forEach((commit, i) =>
    recordRun(
      {
        at: 1_000_000 + i,
        repo: p.repo,
        tier: "inner",
        command: "x",
        commit,
        branch: "b",
        dirty: false,
        seconds: 12 + i,
        slotWaitMin: i,
        load: 1,
        loadAtStart: 2 + i,
        cores: 4,
        ok: true,
        failed: [],
        group: "g",
      },
      p.env,
    ),
  );
  const lines: string[] = [];
  expect(
    await checkTier(
      ["--log"],
      p.settings(),
      (l) => lines.push(l),
      p.env,
      p.repo,
      async () => 0,
    ),
  ).toBe(0);
  const text = lines.join("\n");
  for (const c of commits) expect(text).toContain(c.slice(0, 7));
  expect(text).toContain("waited 2.0 min");
  expect(text).toContain("load at start 4.0");
});

/** A clock that moves 40 s on each reading: a run reads it twice, so it takes 40 s against the inner tier's 30 s. */
const slowClock = () => {
  let t = 0;
  return () => (t += 40_000);
};

const budgetLines = (env: Record<string, string | undefined>) =>
  readFileSync(join(env.LINECLEAR_CONFIG ?? "", "check-runs.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((e) => e.kind === "budget");

test("an idle-machine run over its tier's budget writes a budget line with the tier, the limit and the time", async () => {
  const p = project();
  const args = ["--tier", "inner"];
  expect(
    await checkTier(
      args,
      p.settings(),
      () => {},
      p.env,
      p.repo,
      async () => 0,
      () => [0, 0, 0],
      slowClock(),
    ),
  ).toBe(0);
  const lines = budgetLines(p.env);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ tier: "inner", limitS: 30, seconds: 40 });
});

test("a busy machine's run over budget writes no budget line", async () => {
  const p = project();
  const busy = () => [1e6, 1e6, 1e6];
  expect(
    await checkTier(
      ["--tier", "inner"],
      p.settings(),
      () => {},
      p.env,
      p.repo,
      async () => 0,
      busy,
      slowClock(),
    ),
  ).toBe(0);
  expect(budgetLines(p.env)).toEqual([]);
});

test("a check on machine B is recorded as run on B, so none is counted on the main machine", async () => {
  const p = project();
  sh(["git", "-C", p.repo, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "x"]);
  const env = { ...p.env, LINECLEAR_MACHINE: "boxb.local" };
  expect(
    await checkTier(
      [],
      p.settings(),
      () => {},
      env,
      p.repo,
      async () => 0,
    ),
  ).toBe(0);
  const runs = readRuns(p.repo, 0, env);
  expect(runs.length).toBeGreaterThan(0);
  expect(runs.every((r) => r.machine === "boxb")).toBe(true);
  expect(runs.some((r) => r.machine === machineOf(p.env))).toBe(false);
});

test("a task on machine B has its step check and done proof run on B, none on the main machine", () => {
  const p = project();
  const env = { ...p.env, LINECLEAR_MACHINE: "boxb.local" };
  const pi = join(p.repo, "..", "pi");
  writeFileSync(pi, "#!/bin/sh\nprintf 'SAID: fine\\nGO\\n'\n");
  chmodSync(pi, 0o755);
  const after = "## P\n\n### A Title\n- why: because\n- done when:\n  - it works\n- locks: none\n- after: none\n- files: src/a.ts\n";
  const verdict = checkSteps({
    task: "LIN-7",
    root: p.repo,
    before: "## P\n\n",
    after,
    planner: undefined,
    reviewers: ["openai/gpt-5"],
    env: { ...env, PI_BIN: pi },
  });
  expect(verdict.kind).toBe("go");
  const road =
    "# Roadmap\n\n## P\n\n### R3 Release 0.1 tagged\n- why: because\n- done when:\n  - The release is tagged v0.1.0 on origin.\n- locks: none\n- after: none\n";
  const step = checkRoadmap(road).parsed.steps[0] as Step;
  proveStep({
    repo: p.repo,
    step,
    ref: "origin/main",
    head: "h",
    reviewers: [],
    env,
    now: new Date(),
    tools: { available: () => true },
    run: () => ({ code: 0, out: "abc\trefs/tags/v0.1.0" }),
  });
  const work = readWork(env);
  expect(work.map((w) => w.work).sort()).toEqual(["doneproof", "stepcheck"]);
  expect(work.every((w) => w.machine === "boxb")).toBe(true);
  expect(work.some((w) => w.machine === machineOf(p.env))).toBe(false);
});

test("a fixed log counts runs per machine and finds none of a task's runs away from its machine", () => {
  const p = project();
  const run = (branch: string, machine: string) =>
    ({
      kind: "run",
      at: NOW,
      repo: p.repo,
      machine,
      tier: "merge",
      command: "c",
      commit: "x",
      branch,
      dirty: false,
      seconds: 1,
      load: 0,
      cores: 1,
      ok: true,
      failed: [],
      group: "g",
    }) as CheckRun;
  const runs = [run("work/1-a", "boxb"), run("work/1-a", "boxb"), run("work/2-b", "main")];
  recordWork("LIN-1", "agent", p.env, "boxb");
  recordWork("LIN-1", "review", p.env, "boxb");
  const work = readWork(p.env);
  const counts = runsPerMachine(runs, work, "main");
  expect(counts).toEqual([
    ["boxb", 4],
    ["main", 1],
  ]);
  expect(machineRunLine(counts)).toBe("runs per machine: boxb 4, main 1");
  const home = (key: string) => ({ "work/1-a": "boxb", "LIN-1": "boxb", "work/2-b": "main" })[key];
  expect(strayRuns(runs, work, home)).toEqual([]);
  expect(strayRuns([...runs, run("work/1-a", "main")], work, home)).toEqual(["merge check of work/1-a ran on main, its task is on boxb"]);
});

test("a step's pass is stored in the check log under a hash of its test, the files it loads, the lock file and the bun version", () => {
  const root = tmp("pass-cache");
  const dir = join(root, "log");
  const saved = process.env.LINECLEAR_CONFIG;
  process.env.LINECLEAR_CONFIG = dir;
  try {
    writeFileSync(join(root, "bun.lock"), "lock1");
    writeFileSync(join(root, "a.test.ts"), "test a");
    writeFileSync(join(root, "lib.ts"), "v1");
    const map = { "a.test.ts": ["lib.ts"] };
    const again = (salt = "bun1") => splitCached(root, ["./a.test.ts"], map, salt);
    const first = again();
    recordPassed(root, first.keys, first.run);
    expect(readFileSync(join(dir, "check-runs.jsonl"), "utf8")).toContain(`"a.test.ts":"${first.keys["./a.test.ts"]}"`);
    expect(again().cached).toEqual(["./a.test.ts"]);
    for (const [file, text] of [
      ["a.test.ts", "test b"],
      ["lib.ts", "v2"],
      ["bun.lock", "lock2"],
    ] as const) {
      const old = readFileSync(join(root, file), "utf8");
      writeFileSync(join(root, file), text);
      expect(again().run).toEqual(["./a.test.ts"]);
      writeFileSync(join(root, file), old);
    }
    expect(again("bun2").run).toEqual(["./a.test.ts"]);
  } finally {
    if (saved === undefined) delete process.env.LINECLEAR_CONFIG;
    else process.env.LINECLEAR_CONFIG = saved;
  }

test("a task started on machine B runs its agent, checks, review, step check and done proof on B and none on the main machine", async () => {
  const p = project();
  sh(["git", "-C", p.repo, "add", "-A"]);
  sh(["git", "-C", p.repo, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "x"]);
  const env = { ...p.env, LINECLEAR_MACHINE: "boxb.local" };
  const main = machineOf(p.env);
  expect(main).not.toBe("boxb");

  // the server starts the agent on the task's machine, then the agent checks, reviews and the lane checks there
  recordWork("LIN-9", "agent", env, "boxb");
  for (const tier of ["inner", "merge"]) {
    expect(
      await checkTier(
        ["--tier", tier],
        p.settings(),
        () => {},
        env,
        p.repo,
        async () => 0,
      ),
    ).toBe(0);
  }
  recordWork("LIN-9", "review", env);

  const pi = join(p.repo, "..", "pi");
  writeFileSync(pi, "#!/bin/sh\nprintf 'SAID: fine\\nGO\\n'\n");
  chmodSync(pi, 0o755);
  const after = "## P\n\n### A Title\n- why: because\n- done when:\n  - it works\n- locks: none\n- after: none\n- files: src/a.ts\n";
  checkSteps({ task: "LIN-9", root: p.repo, before: "## P\n\n", after, planner: undefined, reviewers: ["openai/gpt-5"], env: { ...env, PI_BIN: pi } });
  const road =
    "# Roadmap\n\n## P\n\n### R3 Release 0.1 tagged\n- why: because\n- done when:\n  - The release is tagged v0.1.0 on origin.\n- locks: none\n- after: none\n";
  proveStep({
    repo: p.repo,
    step: checkRoadmap(road).parsed.steps[0] as Step,
    ref: "origin/main",
    head: "h",
    reviewers: [],
    env,
    now: new Date(),
    tools: { available: () => true },
    run: () => ({ code: 0, out: "abc\trefs/tags/v0.1.0" }),
  });

  const runs = readRuns(p.repo, 0, env);
  const work = readWork(env);
  expect([...new Set(runs.map((r) => r.tier))].sort()).toEqual(["inner", "merge"]);
  expect(work.map((w) => w.work).sort()).toEqual(["agent", "doneproof", "review", "stepcheck"]);
  expect(runs.every((r) => r.machine === "boxb")).toBe(true);
  expect(work.every((w) => w.machine === "boxb")).toBe(true);
  expect(runsPerMachine(runs, work, main).map(([m]) => m)).toEqual(["boxb"]);
  const home = () => "boxb";
  expect(strayRuns(runs, work, home)).toEqual([]);
  expect(whereRun(p.repo, env).machine).toBe("boxb");
});
