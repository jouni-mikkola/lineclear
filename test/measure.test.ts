import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withHealth } from "../src/health-numbers.ts";
import { laneDays } from "../src/check-runs.ts";
import { reviewRoundLines, roundsNamed, stepCheckVerdict } from "../src/step-check-cost.ts";
import { costOf, measure, median, sessionFolder, worktreeUsage } from "../src/measure.ts";
import { sh, tmp, runCli } from "./helpers.ts";

let root: string;
let history: string;
let env: Record<string, string>;

const at = (iso: string) => Date.parse(`${iso}Z`);
const step = (id: string, after: string) => `### ${id} Step ${id}\n- why: w\n- done when:\n  - d\n- locks: x\n- after: ${after}\n\n`;

/** Two days, counted by hand. Prices are $2 in, $10 out, $0.5 cache read, $3 cache write per million tokens.
 * Day 1: S1 merges 10:00, S2 merges 11:00 (its task started 10:30, 30 min after S1). 2 asks.
 *   cost: S1 1M in = $2, S2 100k out = $1, so $1.50 per step.
 * Day 2: S3 and S4 (after S2) start 09:00 and 10:00 on day 2, 1320 and 1380 min after S2: median 1350. 1 ask.
 * S6 merges with no task: it is named and not counted. Day 2 asks: LIN-3's card and a second card with a question, an
 * Inbox item with the same task and question (the same ask, counted once), another Inbox item (counted), and an item
 * of another space (not counted): 1 + 1 + 1 = 3.
 * ready to merged (a merged task's ready report to its merge, on the merge's day): day 1 LIN-1 10 min and LIN-2 20 min,
 * median 15; day 2 LIN-3 30 min.
 * Not counted: LIN-6, a polish task of S3 that starts after S3 merged, and LIN-7, a queued task that never started.
 *   S3 merges 12:00 (500k in + 1M cache read = $1.50). S4 has no session file. S5 uses a model with no price. */
// The git history is the slow part of the setup: built once, and each test gets a copy, so load cannot push a hook past its 5 s limit. No template: the sample hooks are dozens of files each copy would write.
beforeAll(() => {
  history = tmp("measure-history");
  const commits: [string, string][] = [
    ["Roadmap: start", "2026-01-01T08:00:00"],
    ["LIN-1: S1 first", "2026-01-01T10:00:00"],
    ["LIN-2: S2 second", "2026-01-01T11:00:00"],
    ["LIN-3: S3 third", "2026-01-02T12:00:00"],
    ["LIN-4: S4 fourth", "2026-01-02T13:00:00"],
    ["LIN-5: S5 fifth", "2026-01-02T14:00:00"],
    ["LIN-8: S6 sixth, done by hand", "2026-01-02T15:00:00"],
    ['Revert "LIN-2: S2 second"', "2026-01-02T16:00:00"],
    ['Revert "LIN-99: something else"', "2026-01-02T16:30:00"],
  ];
  const script = [
    "set -e",
    "git init -q -b main --template=",
    ...commits.map(
      ([subject, iso]) => `GIT_AUTHOR_DATE='${iso}Z' GIT_COMMITTER_DATE='${iso}Z' git -c user.name=t -c user.email=t@t commit -q --allow-empty -m '${subject}'`,
    ),
  ].join("\n");
  expect(sh(["sh", "-c", script], { cwd: history }).code).toBe(0);
});
afterAll(() => rmSync(history, { recursive: true, force: true }));

const worktree = (n: number) => `/w/work-${n}-s`;
const task = (n: number, title: string, created: string, ready?: string, merged?: string, facts?: string) => ({
  id: `LIN-${n}`,
  title,
  ...(facts ? { facts } : {}),
  created: at(created),
  worktree: worktree(n),
  ...(ready && merged ? { merged: true, reportedAt: at(ready), doneAt: at(merged) } : {}),
});

function writeTasks(shep: string, repo: string): void {
  writeFileSync(join(shep, "spaces.json"), JSON.stringify([{ name: "proj", path: repo, key: "LIN" }]));
  writeFileSync(
    join(shep, "tasks.json"),
    JSON.stringify({
      tasks: [
        task(1, "S1 Step S1", "2026-01-01T08:30:00", "2026-01-01T09:50:00", "2026-01-01T10:00:00", "Review round 1: 1 major, 2 minor. Round 2: none."),
        task(3, "S3 Step S3", "2026-01-01T09:00:00", "2026-01-02T11:30:00", "2026-01-02T12:00:00", "Review round 1: 2 critical. Review round 2: 1 minor."),
        task(4, "S4 Step S4", "2026-01-01T09:00:00"),
        task(5, "S5 Step S5", "2026-01-02T08:00:00"),
        { id: "LIN-6", title: "S3 Step S3 polish", facts: "round 1: 1 major", created: at("2026-01-02T20:00:00"), worktree: worktree(6) },
        { id: "LIN-7", title: "S5 Step S5 queued", created: at("2026-01-02T08:00:00") },
      ],
    }),
  );
}

const go = (n: number, iso: string) => ({ at: at(iso), id: `go:LIN-${n}:1`, card: { id: `go:LIN-${n}:1`, task: `LIN-${n}`, status: "work" } });
const need = (n: number, iso: string) => ({
  at: at(iso),
  id: `n${n}${iso}`,
  card: { id: `n${n}${iso}`, task: `LIN-${n}`, status: "need", ask: { questions: [{ title: "Which?" }] } },
});

function writeChats(shep: string): void {
  writeFileSync(
    join(shep, "chatlog", "p_box_proj.json"),
    JSON.stringify({
      posted: [
        need(1, "2026-01-01T09:30:00"),
        need(2, "2026-01-01T10:45:00"),
        need(3, "2026-01-02T09:30:00"),
        { at: 1, id: "x", card: { id: "x", status: "done" } },
      ],
    }),
  );
  writeFileSync(
    join(shep, "chatlog", "LIN-1_Agent.json"),
    JSON.stringify({ posted: [go(1, "2026-01-01T09:00:00"), need(1, "2026-01-01T09:30:00")] }), // the same card twice counts once
  );
  // LIN-2 was retired: its record and its chat are in the archive, and still counted
  mkdirSync(join(shep, "archive", "chatlog"), { recursive: true });
  const two = JSON.stringify(task(2, "S2 Step S2", "2026-01-01T10:00:00", "2026-01-01T10:40:00", "2026-01-01T11:00:00"));
  writeFileSync(join(shep, "archive", "tasks-2026-01.jsonl"), `${two}\n${two}\n`);
  writeFileSync(join(shep, "archive", "chatlog", "LIN-2_Agent.json"), JSON.stringify({ posted: [go(2, "2026-01-01T10:30:00")] }));
  writeFileSync(join(shep, "chatlog", "LIN-3_Agent.json"), JSON.stringify({ posted: [go(3, "2026-01-02T09:00:00")] }));
  writeFileSync(join(shep, "chatlog", "LIN-6_Agent.json"), JSON.stringify({ posted: [go(6, "2026-01-02T20:00:00")] }));
  writeFileSync(join(shep, "chatlog", "LIN-4_Agent.json"), JSON.stringify({ posted: [go(4, "2026-01-02T10:00:00")] }));
  const ask = { at: at("2026-01-02T09:45:00"), id: "q1", card: { id: "q1", task: "LIN-3", status: "need", ask: { questions: [{ title: "Which logo?" }] } } };
  writeFileSync(join(shep, "chatlog", "LIN-3_Ask.json"), JSON.stringify({ posted: [ask] }));
  // another space's files are not counted
  writeFileSync(join(shep, "chatlog", "p_box_other.json"), JSON.stringify({ posted: [need(9, "2026-01-01T09:30:00")] }));
  writeFileSync(join(shep, "chatlog", "OTH-1_Agent.json"), JSON.stringify({ posted: [need(9, "2026-01-01T09:31:00")] }));
}

function writeInbox(root: string): void {
  const inbox = join(root, "config", "inbox");
  mkdirSync(inbox, { recursive: true });
  const item = (n: number, task: string, question: string) =>
    writeFileSync(join(inbox, `${n}.json`), JSON.stringify({ n, kind: "step", task, question, choices: ["a"], since: "2026-01-02T09:46:00.000Z" }));
  item(1, "LIN-3", "Which logo?");
  item(2, "LIN-3", "Which font?");
  item(3, "OTH-1", "Which font?");
}

function writeSessions(pi: string): void {
  const session = (n: number, model: string, usage: object) => {
    const dir = join(pi, "sessions", sessionFolder(worktree(n)));
    mkdirSync(dir, { recursive: true });
    const msg = { type: "message", message: { role: "assistant", provider: "p", model, usage } };
    writeFileSync(join(dir, "a.jsonl"), `{"type":"session"}\n${JSON.stringify(msg)}\n{"type":"message","message":{"role":"user"}}\n`);
  };
  session(1, "m", { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 });
  session(2, "m", { input: 0, output: 100_000, cacheRead: 0, cacheWrite: 0 });
  session(3, "m", { input: 500_000, output: 0, cacheRead: 1_000_000, cacheWrite: 0 });
  session(5, "nope", { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 });
  mkdirSync(pi, { recursive: true });
  writeFileSync(join(pi, "models-store.json"), JSON.stringify({ p: { models: [{ id: "m", cost: { input: 2, output: 10, cacheRead: 0.5, cacheWrite: 3 } }] } }));
}

function writeConfig(root: string, repo: string): void {
  const settings = join(root, "config", "projects", "proj");
  mkdirSync(settings, { recursive: true });
  writeFileSync(
    join(settings, "settings.json"),
    JSON.stringify({ repo, space: "proj", check: "true", models: { worker: ["a"], reviewer: ["b"], planner: ["c"] } }),
  );
  // one stall of proj: from 11:00, its remedy 30 min later, its end at 15:00 (240 min). Another project's is not counted.
  const line = (o: object) => JSON.stringify({ kind: "stall", reason: "r", class: "no-room", ...o });
  writeFileSync(
    join(root, "config", "decisions.jsonl"),
    `${[
      line({ time: "2026-01-01T13:00:00Z", project: "proj", step: "S2", event: "stall", since: "2026-01-01T11:00:00Z" }),
      line({ time: "2026-01-01T13:30:00Z", project: "proj", step: "S2", event: "remedy", minutes: 30 }),
      line({ time: "2026-01-01T15:00:00Z", project: "proj", step: "S2", event: "end", minutes: 240 }),
      line({ time: "2026-01-01T13:00:00Z", project: "other", step: "X", event: "stall", since: "2026-01-01T11:00:00Z" }),
    ].join("\n")}\n`,
  );
  // the step check: S3 drew a no-go, then a go; S4 a go. S1, S2, S5 and S6 were planned before it.
  mkdirSync(join(root, "config", "plan-checks"), { recursive: true });
  const answer = (step: string, go: boolean, tokensIn: number, tokensOut: number) => ({
    step,
    key: "k",
    round: 1,
    model: "p/m",
    go,
    said: "",
    missing: "",
    tokensIn,
    tokensOut,
  });
  writeFileSync(
    join(root, "config", "plan-checks", "LIN-90.json"),
    JSON.stringify({ rounds: 1, answers: [answer("S3", false, 500_000, 100_000), answer("S3", true, 500_000, 0), answer("S4", true, 0, 100_000)] }),
  );
  // merge runs: S1 refused once, S3 twice; a pass, an inner run and another project's folder are not refusals
  const runAt = (branch: string, tier: string, ok: boolean, repoDir = realpathSync(repo)) =>
    JSON.stringify({
      kind: "run",
      at: at("2026-01-01T09:00:00"),
      repo: repoDir,
      tier,
      command: "c",
      commit: "x",
      branch,
      dirty: false,
      seconds: 1,
      load: 0,
      cores: 1,
      ok,
      failed: [],
      group: "g",
    });
  writeFileSync(
    join(root, "config", "check-runs.jsonl"),
    `${[runAt("work/1-s", "merge", false), runAt("work/3-s", "merge", false), runAt("work/3-s", "merge", false), runAt("work/3-s", "merge", true), runAt("work/3-s", "inner", false), runAt("work/1-s", "merge", false, "/elsewhere")].join("\n")}\n`,
  );
}

beforeEach(() => {
  root = tmp("measure");
  const repo = join(root, "repo");
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(
    join(repo, "docs", "ROADMAP.md"),
    `# R\n\n## Phase 0: P\n\n${step("S1", "none")}${step("S2", "S1")}${step("S3", "S2")}${step("S4", "S1, S2")}${step("S5", "none")}${step("S6", "none")}`,
  );
  cpSync(join(history, ".git"), join(repo, ".git"), { recursive: true });
  const shep = join(root, "lineclear");
  const pi = join(root, "pi");
  mkdirSync(join(shep, "chatlog"), { recursive: true });
  writeTasks(shep, repo);
  writeChats(shep);
  writeInbox(root);
  writeSessions(pi);
  writeConfig(root, repo);
  env = {
    LINECLEAR_NOW: String(at("2026-01-03T00:00:00")),
    LINECLEAR_CONFIG: join(root, "config"),
    LINECLEAR_HOME: shep,
    PI_CODING_AGENT_DIR: pi,
  };
});
afterEach(() => {
  mock.restore();
  rmSync(root, { recursive: true, force: true });
});

const run = (args: string[]) => runCli(env, args);

test("--refiles runs with no --since, over the last 7 days", async () => {
  const r = await run(["measure", "proj", "--refiles"]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("no step had two fix tasks in one 24 hours");
});

test("--refiles reads fix tasks of two machines from tasks.json and tasks-cold.jsonl and prints each cause", async () => {
  const shep = join(root, "lineclear");
  const h = 3_600_000;
  const t0 = at("2026-01-02T00:00:00");
  const fix = (n: number, title: string, machine: string, hours: number, end?: number, merged?: boolean) => ({
    id: `LIN-${900 + n}`,
    title,
    project: `p:${machine}:proj`,
    created: t0 + hours * h,
    ...(end === undefined ? {} : { doneAt: t0 + end * h, merged }),
  });
  const cold = [fix(1, "Fix S1 t", "a", 0, 0.5, false), fix(2, "S1 Fix: t", "b", 1)];
  writeFileSync(join(shep, "tasks-cold.jsonl"), `${cold.map((t) => JSON.stringify(t)).join("\n")}\n`);
  writeFileSync(join(shep, "tasks.json"), JSON.stringify({ tasks: [fix(3, "S1 Fix: t", "b", 2), fix(4, "Fix S1 t", "a", 3)] }));
  const r = await run(["measure", "proj", "--refiles", "--since", "2026-01-01"]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("S1: most in 24 hours 4, 4 in the period, 1 ended with no merge");
  const causes = r.out.split("\n").flatMap((l) => /^ {2}(LIN-\d+) \S+ \w+: (.*)$/.exec(l)?.slice(1).join(" ") ?? []);
  expect(causes).toEqual(["LIN-901 first", "LIN-902 ended unmerged", "LIN-903 missed open", "LIN-904 open elsewhere"]);
});

test("a fixture of two days gives the hand counted numbers", async () => {
  const r = await run(["measure", "proj", "--since", "2026-01-01", "--json"]);
  expect(r.code).toBe(0);
  const got = JSON.parse(r.out);
  // by hand: S2 is one call with no prompt, S1 (1 M prompt) and S3 (1.5 M prompt) are above 150 k
  expect(got.bands.filter((b: { calls: number }) => b.calls > 0)).toEqual([
    { band: "0-20k", calls: 1, dollars: 1, tokens: 100_000 },
    { band: "150k+", calls: 2, dollars: 3.5, tokens: 2_500_000 },
  ]);
  delete got.bands;
  expect(got.waitMinutes).toEqual([30, 1320, 1380]);
  delete got.waitMinutes;
  // the planted log has 4 merge-tier runs, 3 red, none with a cause (logged before L218)
  expect(got.redMerges).toEqual({ total: 4, red: 3, causes: [["unnamed", 3]] });
  delete got.redMerges;
  // no gates in the fixture repo, so no catches to list
  expect(got.catches).toEqual([]);
  delete got.catches;
  expect(got).toEqual({
    days: [
      {
        date: "2026-01-01",
        asks: 2,
        wait: { median: 30, tasks: 1 },
        cost: { perStep: 1.5, tokens: 550000, steps: 2 },
        lane: { median: 15, tasks: 2, longest: 20 },
        turns: 0,
      },
      {
        date: "2026-01-02",
        asks: 3,
        wait: { median: 1350, tasks: 2 },
        cost: { perStep: 1.5, tokens: 1500000, steps: 1 },
        lane: { median: 30, tasks: 1, longest: 30 },
        turns: 0,
      },
    ],
    unpriced: ["p/nope"],
    reviews: [],
    lockAfterEnd: null,
    waitCauses: [
      { step: "S2", minutes: { "no cause recorded": 30 } },
      { step: "S3", minutes: { "no cause recorded": 1320 } },
      { step: "S4", minutes: { "no cause recorded": 1380 } },
    ],
    parts: [],
    causes: [
      { cause: "input", perStep: 1, share: 2 / 3 },
      { cause: "output", perStep: 1 / 3, share: 2 / 9 },
      { cause: "cacheRead", perStep: 1 / 6, share: 1 / 9 },
      { cause: "cacheWrite", perStep: 0, share: 0 },
    ],
    partHealth: [],
    mergeLine: [],
    ownerTaps: { perStep: 0, steps: 6, taps: 0 },
    // by hand: S1, S2, S5, S6 before; S3, S4 with. Reverts name S2 only. Questions: S1 1, S2 1, S3 3.
    stepCheck: {
      before: { steps: 4, noGos: 0, reviewRounds: 1, refusedMerges: 1, reverts: 1, questions: 2, tokens: 0, dollars: 0 },
      withCheck: { steps: 2, noGos: 1, reviewRounds: 2, refusedMerges: 2, reverts: 0, questions: 3, tokens: 1_200_000, dollars: 4 },
      unpriced: [],
    },
    roadmapReads: { before: { sessions: 0, whole: 0 }, after: { sessions: 0, whole: 0 } },
    noSession: ["LIN-4"],
    noTask: ["S6"],
    stepTokens: [1_000_000, 100_000, 1_500_000, 20],
    // task minutes: LIN-1 60, LIN-2 30, LIN-3 180, LIN-4 840 and LIN-5 960 (running until now), LIN-6 240: 2310
    health: {
      since: "2026-01-01T00:00:00.000Z",
      until: "2026-01-03T00:00:00.000Z",
      systemWait: 240 / 2310,
      stallsPerDay: 0.5,
      toRemedy: 30,
      mergesPerDay: 3,
      tokensPerStep: 650_005,
    },
  });
});

test("--health writes the five measures to docs/numbers.md under Health, and again in place", async () => {
  const file = join(root, "repo", "docs", "numbers.md");
  writeFileSync(file, "# Numbers\n\nIntro.\n\n## L16: the merge lane\n\nKept.\n");
  const r = await run(["measure", "proj", "--since", "2026-01-01", "--health"]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("health, share of task time waiting on the system: 10.4 %");
  const text = readFileSync(file, "utf8");
  expect(text).toContain("## Health\n");
  expect(text).toContain("| stalls per day | 0.5 | lower is better |");
  expect(text).toContain("| minutes from a stall to its remedy (median) | 30 | lower is better |");
  expect(text).toContain("| merges per day | 3.0 | higher is better |");
  expect(text).toContain("| tokens per merged step | 650005 | lower is better |");
  expect(text.indexOf("## Health")).toBeLessThan(text.indexOf("## L16"));
  expect(text).toContain("Kept.");
  await run(["measure", "proj", "--since", "2026-01-01", "--health"]);
  expect(readFileSync(file, "utf8")).toBe(text);
  const json = JSON.parse((await run(["measure", "proj", "--since", "2026-01-01", "--json"])).out);
  expect(withHealth("# N\n", "p", json.health)).toContain("# N\n\n## Health");
});

test("the text form lists each day and names what it left out", async () => {
  const r = await run(["measure", "proj", "--since", "2026-01-01"]);
  expect(r.out).toContain("ready to merged (median min)");
  expect(r.out).toContain("2026-01-01     2  30.0 (1 tasks)");
  expect(r.out).toContain("15.0 (2 tasks, longest 20.0)");
  expect(r.out).toContain("2026-01-02     3  1350.0 (2 tasks)");
  expect(r.out).toContain("no price in pi's model data, steps not counted: p/nope");
  expect(r.out).toContain("1 merged step had no task, not counted: S6");
  expect(r.out).toContain("no session file found, steps not counted: LIN-4");
});

test("a repo with parts gets a line of health per part, its debts counted", async () => {
  const repo = join(root, "repo");
  mkdirSync(join(repo, "docs", "parts"), { recursive: true });
  const page = (name: string, debts: string) =>
    `# ${name}\n\nWhat it is for.\n\n## Invariants\n\n- it holds\n\n## Interface\n\nnone\n\n## Files\n\n- \`src/${name}.ts\`\n\n## Tests\n\n- none\n\n## Debts\n\n${debts}\n`;
  writeFileSync(join(repo, "docs", "parts", "a.md"), page("a", "- one\n- two"));
  writeFileSync(join(repo, "docs", "parts", "b.md"), page("b", "- none"));
  const r = await run(["measure", "proj", "--since", "2026-01-01"]);
  expect(r.out).toContain("part health (higher is worse): part  score");
  expect(r.out).toMatch(/\n {2}a +2 +0 +0 +2 +0 +0 +0 +0\n {2}b +0 /);
});

test("the text form counts the step check before and with it", async () => {
  const r = await run(["measure", "proj", "--since", "2026-01-01"]);
  expect(r.out).toContain(
    "step check, planned before the check: 4 steps, 0 no-gos, 3 rework rounds (1 review, 1 refused merges, 1 reverts), 2 owner questions, check 0 tokens, $0.00;",
  );
  expect(r.out).toContain(
    "step check, planned with the check: 2 steps, 1 no-gos, 4 rework rounds (2 review, 2 refused merges, 0 reverts), 3 owner questions, check 1200000 tokens, $4.00;",
  );
});

test("the verdict waits for 20 steps, then keeps the check only when it costs less than the rework it saved", () => {
  const group = (steps: number, reviewRounds: number, questions: number, dollars: number) => ({
    steps,
    noGos: 0,
    reviewRounds,
    refusedMerges: 0,
    reverts: 0,
    questions,
    tokens: 0,
    dollars,
  });
  const n = (withCheck: ReturnType<typeof group>) => ({ before: group(20, 20, 10, 0), withCheck, unpriced: [] });
  expect(stepCheckVerdict(n(group(19, 0, 0, 0)), 5).kind).toBe("waiting");
  // 1 round per step before, 0.5 with: 10 rounds saved at $5 is $50
  expect(stepCheckVerdict(n(group(20, 10, 10, 40)), 5)).toMatchObject({ kind: "keep", savedDollars: 50 });
  expect(stepCheckVerdict(n(group(20, 10, 10, 60)), 5).kind).toBe("off");
  expect(stepCheckVerdict(n(group(20, 0, 11, 1)), 5)).toMatchObject({ kind: "off", reason: "owner questions per step rose" });
});

test("--since drops the earlier days", async () => {
  const r = await run(["measure", "proj", "--since", "2026-01-02", "--json"]);
  expect(JSON.parse(r.out).days.map((d: { date: string }) => d.date)).toEqual(["2026-01-02"]);
});

test("a bad call is refused", async () => {
  expect((await run(["measure", "proj"])).code).toBe(2);
  expect((await run(["measure", "proj", "--since", "soon"])).code).toBe(2);
  const none = await run(["measure", "nope", "--since", "2026-01-01"]);
  expect(none.code).toBe(1);
  expect(none.out).toContain("no project named 'nope'");
});

test("median, tiers and the session folder name", () => {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([1, 2, 3, 4])).toBe(2.5);
  const price = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, tiers: [{ inputTokensAbove: 100, input: 3 }] };
  const u = { model: "m", provider: "p", input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
  expect(costOf(u, price)).toBe(3);
  expect(costOf({ ...u, input: 50 }, price)).toBe(0.00005);
  expect(sessionFolder("/home/a/.x/b")).toBe("--home-a-.x-b--");
  expect(measure({ asks: [], steps: [], tasks: [], usageOf: () => undefined, priceOf: () => undefined }, "2026-01-01").days).toHaveLength(1);
});

test("the text form prints cost per call by context band, from the ledger sessions", async () => {
  const r = await run(["measure", "proj", "--since", "2026-01-01"]);
  const lines = r.out.split("\n").filter((l: string) => l.startsWith("cost per call, context "));
  expect(lines).toEqual([
    expect.stringMatching(/^cost per call, context 0-20k: 1 calls, \$1\.000 per call, /),
    expect.stringMatching(/^cost per call, context 150k\+: 2 calls, \$.* per call, /),
  ]);
});

test("the text lines print tokens per merged step next to the cost", async () => {
  const r = await run(["measure", "proj", "--since", "2026-01-01"]);
  expect(r.out).toContain("tokens per merged step");
  expect(r.out).toMatch(/2026-01-01 .*1\.50 \(2 steps\)\s+550000\s/);
  expect(r.out).toMatch(/2026-01-02 .*1\.50 \(1 steps\)\s+1500000\s/);
});

test("the merge line: merges per hour and the longest wait of a turn, from a planted log", () => {
  const run = (branch: string, group: string, end: string, seconds: number, ok = true, tier: "merge" | "inner" = "merge") => ({
    kind: "run" as const,
    at: at(end),
    repo: "/r",
    tier,
    command: "c",
    commit: "x",
    branch,
    dirty: false,
    seconds,
    load: 0,
    cores: 4,
    ok,
    failed: [],
    group,
  });
  const runs = [
    run("a", "1", "2026-11-01T09:50:00", 60, true, "inner"),
    run("a", "0", "2026-11-01T09:00:00", 300),
    run("a", "2", "2026-11-01T10:05:00", 300),
    run("b", "3", "2026-11-01T10:00:00", 60, true, "inner"),
    run("b", "4", "2026-11-01T10:30:00", 300),
    run("c", "5", "2026-11-01T10:40:00", 300, false),
    run("d", "6", "2026-11-02T08:00:00", 600),
  ];
  const days = laneDays(runs, at("2026-11-01T00:00:00"));
  // a waited 10 min (09:50 to its start 10:00), b 25 min (10:00 to 10:25); c failed, so no merge
  expect(days).toEqual([
    { date: "2026-11-01", merges: 2, perHour: 2 / 24, longestWait: 25 },
    { date: "2026-11-02", merges: 1, perHour: 1 / 24, longestWait: null },
  ]);
});

test("every machine in Settings adds its work: a step done there is counted, its asks too, and a machine that does not answer is named", async () => {
  const raw = {
    asks: [at("2026-01-02T12:00:00")],
    turns: [],
    tasks: [
      {
        id: "LIN-4",
        title: "S6 Step S6",
        start: at("2026-01-02T14:00:00"),
        worktree: "/box/w",
        usage: [{ provider: "p", model: "m", input: 0, output: 100_000, cacheRead: 0, cacheWrite: 0 }],
        prices: [{ input: 2, output: 10, cacheRead: 0.5, cacheWrite: 3 }],
        parts: [],
      },
    ],
  };
  const fake = join(root, "ssh");
  writeFileSync(fake, `#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\ncase "$1" in box) echo '${JSON.stringify(raw)}';; *) exit 255;; esac\n`, {
    mode: 0o755,
  });
  const machines = (host: string) =>
    writeFileSync(
      join(root, "config", "machines.json"),
      JSON.stringify({
        machines: [
          { host, state: "ready", since: "2026-01-01T00:00:00.000Z" },
          { host: "gone", state: "ready", since: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );
  machines("box");
  env.LINECLEAR_SSH = fake;
  const r = await run(["measure", "proj", "--since", "2026-01-01", "--json"]);
  const day2 = JSON.parse(r.out).days[1];
  expect(day2.asks).toBe(4);
  expect(day2.cost).toEqual({ perStep: 1.25, tokens: 800_000, steps: 2 });
  const text = (await run(["measure", "proj", "--since", "2026-01-01"])).out;
  expect(text).toContain("counted on this machine and box");
  expect(text).toContain("gone was not counted");
  const local = JSON.parse((await run(["measure", "proj", "--since", "2026-01-01", "--json", "--local"])).out).days[1];
  expect(local.asks).toBe(3);
});

test("the cost per step is split by cause and the parts sum to the cost per step", async () => {
  // by hand, over S1, S2, S3: input $2 + $0 + $1 = 3, output $1, cache read $0.5; 4.5 over 3 steps = $1.50 each
  const r = JSON.parse((await run(["measure", "proj", "--since", "2026-01-01", "--json"])).out);
  const by = Object.fromEntries(r.causes.map((c: { cause: string; perStep: number; share: number }) => [c.cause, c]));
  expect(by.input.perStep).toBeCloseTo(1, 9);
  expect(by.output.perStep).toBeCloseTo(1 / 3, 9);
  expect(by.cacheRead.perStep).toBeCloseTo(1 / 6, 9);
  expect(by.cacheWrite.perStep).toBe(0);
  expect(by.input.share).toBeCloseTo(2 / 3, 9);
  const perStep = r.causes.reduce((a: number, c: { perStep: number }) => a + c.perStep, 0);
  expect(Math.abs(perStep - 1.5) / 1.5).toBeLessThan(0.01);
  const text = (await run(["measure", "proj", "--since", "2026-01-01"])).out;
  expect(text).toContain("cost cause input: $1.00 per merged step, 66.7 %");
});

const roundTask = (title: string, facts: string) => ({ title, facts });

test("review rounds: a clean first round has no second round", () => {
  expect(roundsNamed("Review round 1: none.")).toBe(1);
  expect(reviewRoundLines(["S1"], [roundTask("S1 Step", "Review round 1: none.")], 2)).toEqual([
    "review rounds per merged step: median 1, most 1, 0 steps with a task over the limit of 2",
  ]);
});

test("review rounds: findings stop at the set limit", () => {
  const facts = "Review round 1: 1 major. Round 2: 1 minor.";
  expect(roundsNamed(facts)).toBe(2);
  const third = roundTask("S2 Step", "Round 1: 1 major. Round 2: 1 major. Round 3: none");
  expect(reviewRoundLines(["S1", "S2"], [roundTask("S1 Step", facts), third], 2)).toEqual([
    "review rounds per merged step: median 2.5, most 3, 1 steps with a task over the limit of 2",
  ]);
});

test("review rounds: no merged step", () => {
  expect(reviewRoundLines([], [], 2)).toEqual(["review rounds: no merged steps"]);
});

test("a reviewer's calls carry their role and round, and measure prices the review per task", () => {
  const pi = tmp("review-ledger");
  const wt = "/w/work-9-l9-x";
  const dir = join(pi, "sessions", sessionFolder(wt));
  mkdirSync(dir, { recursive: true });
  const call = (input: number) =>
    JSON.stringify({ type: "message", message: { role: "assistant", provider: "p", model: "m", usage: { input, output: 0, cacheRead: 0, cacheWrite: 0 } } });
  const user = (text: string) => JSON.stringify({ type: "message", message: { role: "user", content: text } });
  writeFileSync(join(dir, "1.jsonl"), `${user("Build step L9")}\n${call(1_000_000)}\n`);
  writeFileSync(join(dir, "2.jsonl"), `${user('Use LINECLEAR_CHAT="L9/Reviewer" and review')}\n${call(500_000)}\n`);
  writeFileSync(join(dir, "3.jsonl"), `${user("LINECLEAR_CHAT=L9/Reviewer review again")}\n${call(250_000)}\n`);
  const usage = worktreeUsage(wt, { PI_CODING_AGENT_DIR: pi, HOME: pi }) ?? [];
  expect(usage.map((u) => [u.role, u.round])).toEqual([
    [undefined, undefined],
    ["reviewer", 1],
    ["reviewer", 2],
  ]);
  const price = { input: 2, output: 0, cacheRead: 0, cacheWrite: 0 };
  const task = { id: "T-9", title: "L9 x", start: Date.parse("2026-01-02"), worktree: wt };
  const n = measure({ asks: [], steps: [], tasks: [task], usageOf: () => usage, priceOf: () => price }, "2026-01-01");
  expect(n.reviews).toEqual([{ task: "T-9", rounds: 2, tokens: 750_000, dollars: 1.5 }]);
});

test("lineclear measure prints a task's review in tokens and dollars from its reviewer sessions", async () => {
  const dir = join(env.PI_CODING_AGENT_DIR as string, "sessions", sessionFolder(worktree(2)));
  const user = JSON.stringify({ type: "message", message: { role: "user", content: 'LINECLEAR_CHAT="LIN-2/Reviewer"\nreview round 1' } });
  const call = JSON.stringify({
    type: "message",
    message: { role: "assistant", provider: "p", model: "m", usage: { input: 500_000, output: 0, cacheRead: 0, cacheWrite: 0 } },
  });
  writeFileSync(join(dir, "reviewer.jsonl"), `${user}\n${call}\n`);
  const r = await run(["measure", "proj", "--since", "2026-01-01"]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("review LIN-2: 500000 tokens, $1.00 (1 round)");
});
