import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordCall } from "../pi/extension.ts";
import { usageLimits } from "../src/limits.ts";
import { describeOne, harnesses, modelFile, readRegistry } from "../src/models.ts";
import { readSettings } from "../src/project.ts";
import { refreshQuota, unknownAdapter } from "../src/quota.ts";
import { availability } from "../src/stalls.ts";
import { realWorld, type World } from "../src/rules.ts";
import { pickChecker } from "../src/stepcheck.ts";
import { readFixes } from "../src/self-fix.ts";
import {
  cheapest,
  trackReviewer,
  ensureTrackSpace,
  runTrack,
  STAGE_LIMIT,
  STAGES,
  trackAddCommand,
  trackLog,
  trackMain,
  trackProject,
  type Stage,
  type TrackWorld,
} from "../src/track.ts";
import { tmp } from "./helpers.ts";

const MIN = 60_000;

/** A fake chain: each stage is reached after `takes` minutes; `stuck` never is; a stall the rule loop saw. */
function fake(o: { stuck?: Stage; fails?: Stage; stall?: { class: "account-full"; evidence: string } } = {}) {
  const clock = { at: Date.UTC(2026, 10, 1, 3, 30) };
  const acts: Stage[] = [];
  const begun = new Map<Stage, number>();
  const w: TrackWorld = {
    now: () => clock.at,
    wait: async (ms) => {
      clock.at += ms;
    },
    act: async (s) => {
      acts.push(s);
      begun.set(s, clock.at);
      return s === o.fails ? "systemctl: unit not found" : undefined;
    },
    reached: async (s) => s !== o.stuck && clock.at - (begun.get(s) ?? clock.at) >= 2 * MIN,
    stall: () => o.stall,
  };
  return { w, acts };
}

function setup() {
  const dir = tmp("track");
  const config = join(dir, "config");
  mkdirSync(join(config, "projects", "demo"), { recursive: true });
  const models = { worker: ["a/cheap"], reviewer: ["a/dear"], planner: ["a/dear"] };
  writeFileSync(join(config, "projects", "demo", "settings.json"), JSON.stringify({ repo: dir, space: "demo", check: "true", self: true, models }));
  const env = { ...process.env, LINECLEAR_CONFIG: config };
  const adds: string[][] = [];
  const list: { id: string; title: string; status: string }[] = [];
  const rules: World = {
    ...realWorld(env),
    now: () => new Date(Date.UTC(2026, 10, 1, 6)),
    tasks: () => list,
    addTask: (_s, title, brief) => {
      adds.push([title, brief]);
      list.push({ id: `LIN-${100 + adds.length}`, title, status: "work" });
      return undefined;
    },
  };
  return { env, rules, adds };
}

test("a chain that gets through every stage passes, with the restart and the switch in the middle", async () => {
  const { w, acts } = fake();
  const r = await runTrack(w, MIN);
  expect(r.pass).toBe(true);
  expect(acts).toEqual([...STAGES]);
  expect(acts.indexOf("restart")).toBeGreaterThan(acts.indexOf("start"));
  expect(acts.indexOf("switch")).toBeLessThan(acts.indexOf("merge"));
  expect(r.stages.map((s) => s.minutes)).toEqual(STAGES.map(() => 2));
  expect(r.minutes).toBe(16);
});

test("a stage that never ends breaks the run at its limit, named by the stall the rule loop saw", async () => {
  const { w } = fake({ stuck: "work", stall: { class: "account-full", evidence: "anthropic is full until 08:00" } });
  const r = await runTrack(w, MIN);
  expect(r.pass).toBe(false);
  expect(r.broke).toEqual({ stage: "work", class: "account-full", evidence: "anthropic is full until 08:00" });
  expect(r.stages.map((s) => s.stage)).toEqual(["request", "plan", "start", "restart", "switch"]);
  // the five stages before took 2 min each, the stuck one its whole limit
  expect(r.minutes).toBe(10 + STAGE_LIMIT.work);
  // no stall seen: no sign of life
  expect((await runTrack(fake({ stuck: "plan" }).w, MIN)).broke?.class).toBe("no-sign-of-life");
});

test("a stage whose command fails breaks at once as a failing command", async () => {
  const r = await runTrack(fake({ fails: "restart" }).w, MIN);
  expect(r.broke).toEqual({ stage: "restart", class: "command-failed", evidence: "restart: systemctl: unit not found" });
});

test("a broken run files one fix and logs the run; after an update it also rolls back; a pass does neither", async () => {
  const t = setup();
  const out: string[] = [];
  const rolled: string[] = [];
  const deps = (w: TrackWorld) => ({
    track: w,
    rules: t.rules,
    rollBack: (why: string) => {
      rolled.push(why);
      return "rolled back to the version before the update";
    },
  });
  expect(await trackMain([], (l) => out.push(l), t.env, deps(fake().w))).toBe(0);
  expect(out).toEqual(["track: pass in 16 min"]);
  expect(t.adds).toHaveLength(0);

  out.length = 0;
  const broken = () => fake({ stuck: "review", stall: { class: "account-full", evidence: "anthropic is full" } }).w;
  expect(await trackMain(["--after-update"], (l) => out.push(l), t.env, deps(broken()))).toBe(1);
  expect(out[0]).toBe("track: broke at review: account full (anthropic is full)");
  expect(out[1]).toBe("track: filed a fix: Plan: fix account full");
  expect(out[2]).toBe("track: rolled back to the version before the update");
  expect(rolled).toEqual(["the test track broke at review (account full)"]);
  expect(t.adds).toHaveLength(1);
  expect(t.adds[0]?.[1]).toContain("test track after an update broke at review: anthropic is full");
  expect(readFixes(t.env)["account-full"]?.title).toBe("Plan: fix account full");

  // the next night it breaks the same way: the fix is open, so no second one, and no rollback without an update
  out.length = 0;
  expect(await trackMain([], (l) => out.push(l), t.env, deps(broken()))).toBe(1);
  expect(out[1]).toBe("track: a fix is already open: Plan: fix account full");
  expect(out).toHaveLength(2);
  expect(t.adds).toHaveLength(1);
  expect(rolled).toHaveLength(1);

  const runs = readFileSync(trackLog(t.env), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  expect(runs.map((r) => [r.pass, r.afterUpdate])).toEqual([
    [true, false],
    [false, true],
    [false, false],
  ]);
  expect(await trackMain(["--nope"], (l) => out.push(l), t.env)).toBe(2);
});

test("the track picks the two cheapest models, unpriced ones last", () => {
  const price: Record<string, number> = { "a/dear": 20, "b/cheap": 1, "c/mid": 5 };
  expect(cheapest(["x/unpriced", "a/dear", "b/cheap", "c/mid", "b/cheap"], (m) => price[m])).toEqual(["b/cheap", "c/mid"]);
  expect(cheapest(["x/one"], () => undefined)).toEqual(["x/one"]);
});

test("the track's reviewer is the cheapest of the list from another company than the planner, and the step check then finds a checker", () => {
  const price: Record<string, number> = { "bridge/sonnet": 1, "bridge-b/sonnet": 1, "openai-codex/gpt-6.1-sol": 3, "google/gemini-x": 2 };
  const reviewers = Object.keys(price);
  const p = (m: string) => price[m];
  const other = trackReviewer("bridge/sonnet", reviewers, p);
  expect(other).toBe("google/gemini-x");
  expect(pickChecker("bridge/sonnet", [other as string, "bridge/sonnet"])).toBe("google/gemini-x");
  expect(trackReviewer("bridge/sonnet", ["bridge/sonnet", "bridge-b/sonnet"], p)).toBeUndefined();
});

test("with no reviewer from another company the track stops at the request stage as command-failed", async () => {
  const t = setup();
  const world = { ...t.env, XDG_DATA_HOME: tmp("track-data") };
  const out: string[] = [];
  expect(await trackMain([], (l) => out.push(l), world, { rules: t.rules })).toBe(1);
  expect(out[0]).toContain("track: broke at request");
  const run = JSON.parse(readFileSync(trackLog(world), "utf8").trim());
  expect(run.broke).toMatchObject({ stage: "request", class: "command-failed" });
  expect(run.broke.evidence).toContain("no step checker");
});

test("the track's project add passes the space, so it needs no detection", () => {
  const cmd = trackAddCommand("/r", ["a", "b"], ["b", "a"], "a");
  expect(cmd.slice(cmd.indexOf("--space"), cmd.indexOf("--space") + 2)).toEqual(["--space", "lineclear-track"]);
});

test("the track adds its space when the board has none, and leaves it when it has", () => {
  const dir = tmp("track-space");
  const log = join(dir, "calls.log");
  const bin = join(dir, "shepherdr");
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> ${log}\n[ "$1 $2" = "space list" ] && [ -f ${dir}/have ] && printf 'lineclear-track  /r\\n'\nexit 0\n`, {
    mode: 0o755,
  });
  const env = { ...process.env, SHEPHERDR_BIN: bin };
  expect(ensureTrackSpace("/r", env)).toBeUndefined();
  expect(readFileSync(log, "utf8")).toContain("space add /r --name lineclear-track");
  writeFileSync(join(dir, "have"), "");
  writeFileSync(log, "");
  expect(ensureTrackSpace("/r", env)).toBeUndefined();
  expect(readFileSync(log, "utf8")).not.toContain("space add");
});

// L208: a run on providers that are in no list of the repo. They are declared only by the registry fixture (what a
// harness prints) and its models.json; no file of src/ or server/ knows them.

const THIRD = join(import.meta.dir, "fixtures", "third-company");
const sh = (cwd: string, ...args: string[]) => {
  const p = Bun.spawnSync(["git", ...args], {
    cwd,
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });
  return p.stdout.toString().trim();
};

/** The chain on a real bare origin: each stage is done by the model its role picks from the fixture, and the merge is a real one. */
function thirdWorld() {
  const dir = tmp("third");
  const origin = join(dir, "origin.git");
  const repo = join(dir, "repo");
  sh(dir, "init", "-q", "--bare", "-b", "main", origin);
  sh(dir, "clone", "-q", origin, repo);
  writeFileSync(join(repo, "README.md"), "seed\n");
  sh(repo, "checkout", "-q", "-b", "main");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "T0: the seed");
  sh(repo, "push", "-q", "origin", "main");

  const home = join(dir, "home");
  mkdirSync(home);
  copyFileSync(join(THIRD, "models.json"), join(home, "models.json"));
  process.env.LINECLEAR_HOME = home;
  // the self project lists what the registry fixture offers; the track picks its models from that, priced by pi's own store
  const registry = readRegistry(harnesses({ PI_BIN: join(THIRD, "registry.sh"), OPENCODE_BIN: "/nonexistent/opencode" })).map((m) => `${m.provider}/${m.name}`);
  const config = join(dir, "config");
  const pi = join(dir, "pi");
  mkdirSync(pi);
  copyFileSync(join(THIRD, "models-store.json"), join(pi, "models-store.json"));
  const bin = join(dir, "shepherdr");
  writeFileSync(bin, '#!/bin/sh\n[ "$1 $2" = "space list" ] && printf \'lineclear-track  /r\\n\'\nexit 0\n', { mode: 0o755 });
  const env = { ...process.env, LINECLEAR_CONFIG: config, PI_CODING_AGENT_DIR: pi, SHEPHERDR_BIN: bin };
  const models = { worker: registry, reviewer: registry, planner: registry };
  for (const name of ["lineclear", "lineclear-track"]) {
    mkdirSync(join(config, "projects", name), { recursive: true });
    writeFileSync(join(config, "projects", name, "settings.json"), JSON.stringify({ repo, space: name, check: "true", self: name === "lineclear", models }));
  }
  const picked = trackProject(repo, env);
  if (typeof picked === "string") throw new Error(picked);
  const settings = readSettings("lineclear-track", env);
  if (typeof settings === "string") throw new Error(settings);
  const file = modelFile(home);
  const two = picked.worker;
  const planner = settings.models.planner[0] as string;
  const reviewer = settings.models.reviewer[0] as string;

  const by: Partial<Record<Stage, string>> = {};
  const w: TrackWorld = {
    now: () => Date.now(),
    wait: async () => {},
    act: async (s) => {
      const model = s === "review" ? reviewer : s === "switch" ? (two[1] as string) : s === "request" || s === "plan" ? planner : (two[0] as string);
      by[s] = model;
      if (s === "work") {
        sh(repo, "checkout", "-q", "-b", "work/1");
        writeFileSync(join(repo, "done.txt"), "worked\n");
        sh(repo, "add", "-A");
        sh(repo, "commit", "-q", "-m", `worked by ${model}`);
      }
      if (s === "merge") {
        sh(repo, "checkout", "-q", "main");
        sh(repo, "merge", "-q", "--no-ff", "-m", `T1: merged after review by ${reviewer}`, "work/1");
        sh(repo, "push", "-q", "origin", "main");
      }
      return undefined;
    },
    reached: async () => true,
    stall: () => undefined,
  };
  return { w, by, origin, two, planner, reviewer, file, env };
}

test("the fixture's models are found only through the registry fixture and its models.json, and no file of src/ or server/ names them", () => {
  const prev = process.env.LINECLEAR_HOME;
  try {
    const t = thirdWorld();
    expect(t.planner).toBe("quillon/lumen-3-mini");
    expect(t.two).toEqual(["quillon/lumen-3-mini", "vexor/praxis-2"]);
    expect(t.reviewer).toBe("vexor/praxis-2");
    expect(describeOne(t.planner, t.file).company).toBe("quillon-labs");
    expect(describeOne(t.reviewer, t.file).company).toBe("vexor-ai");
    for (const f of ["templates", "src", "server", "pi", "scripts"]) {
      const hit = Bun.spawnSync(["grep", "-rlE", "--exclude-dir=node_modules", "quillon|vexor|lumen-3|praxis-2", join(import.meta.dir, "..", f)]);
      expect(hit.stdout.toString().trim()).toBe("");
    }
  } finally {
    if (prev === undefined) delete process.env.LINECLEAR_HOME;
    else process.env.LINECLEAR_HOME = prev;
  }
});

test("a run with every role on one fake provider and its reviewer on a second goes from request to a merge on main", async () => {
  const prev = process.env.LINECLEAR_HOME;
  try {
    const t = thirdWorld();
    const t0 = tmp("third-run");
    const out: string[] = [];
    expect(await trackMain(["--json"], (l) => out.push(l), { ...t.env, LINECLEAR_CONFIG: join(t0, "config") }, { track: t.w })).toBe(0);
    expect(JSON.parse(out[0] as string).pass).toBe(true);
    for (const s of ["request", "plan", "start", "restart", "work", "merge"] as Stage[]) expect(t.by[s]?.startsWith("quillon/")).toBe(true);
    expect(t.by.switch).toBe("vexor/praxis-2");
    expect(t.by.review).toBe("vexor/praxis-2");
    const verify = tmp("third-verify");
    sh(verify, "clone", "-q", t.origin, "v");
    const log = sh(join(verify, "v"), "log", "origin/main", "--format=%s");
    expect(log).toContain("T1: merged after review by vexor/praxis-2");
    expect(log).toContain("worked by quillon/lumen-3-mini");
    expect(readFileSync(join(verify, "v", "done.txt"), "utf8")).toBe("worked\n");
  } finally {
    if (prev === undefined) delete process.env.LINECLEAR_HOME;
    else process.env.LINECLEAR_HOME = prev;
  }
});

test("the fake provider's quota is unknown, never unlimited, and the pace gate holds it after three 429 answers", async () => {
  const root = tmp("third-quota");
  const env = { LINECLEAR_CONFIG: join(root, "config"), PI_CODING_AGENT_DIR: join(root, "pi"), HOME: root };
  const now = Date.parse("2026-11-02T12:00:00Z");
  const get = async () => ({ ok: false, json: async () => ({}) });
  recordCall("quillon", 200, env, new Date(now));
  expect(await unknownAdapter.read()).toBe("unknown");
  expect(usageLimits(["quillon"], env, now).find((u) => u.account === "quillon")?.unreported).toBe(true);
  expect(availability("quillon/lumen-3-mini", env, new Date(now))).toBe("ok");
  for (const i of [1, 2, 3]) recordCall("quillon", 429, env, new Date(now + i * 1000));
  await refreshQuota(env, now + 5000, get);
  expect(availability("quillon/lumen-3-mini", env, new Date(now + 5000))).toBe("out");
  // the reviewer's company is not held by the first one's 429s
  expect(availability("vexor/praxis-2", env, new Date(now + 5000))).toBe("ok");
});
