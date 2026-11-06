import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir, decisionsPath } from "../pi/config.ts";
import { TEST_PROJECT } from "./prefs.ts";
import { modelPrice } from "./routine.ts";
import { serverBin } from "./paths.ts";
import { company } from "./company.ts";
import { changeSettings, readSettings } from "./project.ts";
import { lineclearTasks } from "./roadmap-source.ts";
import { realWorld, type World } from "./rules.ts";
import { fileFixNow, selfProject } from "./self-fix.ts";
import { CLASS_INFO, readDecisionsSince, type StallClass } from "./stall-class.ts";
import { MIN } from "./time.ts";
import { gitWith } from "./git.ts";

// The test track: a small fixture project that runs the whole chain (a request, its plan, the start, the work, the
// review and the merge) with a forced restart and a switch to another model in the middle, on the cheapest models.
// It passes, or names the stage and the stall class that broke it. A broken run files the fix, and a broken
// run just after an update puts the previous version back.

export const STAGES = ["request", "plan", "start", "restart", "switch", "work", "review", "merge"] as const;
export type Stage = (typeof STAGES)[number];

/** How long each stage may take, in minutes, before the run counts as broken. */
export const STAGE_LIMIT: Record<Stage, number> = { request: 2, plan: 40, start: 15, restart: 5, switch: 5, work: 60, review: 45, merge: 20 };

export interface TrackWorld {
  now(): number;
  wait(ms: number): Promise<void>;
  /** Does what the stage does (the request, the restart, the switch); others do nothing. Returns why it failed. */
  act(stage: Stage): Promise<string | undefined>;
  /** Whether the chain has got as far as the stage's goal. */
  reached(stage: Stage): Promise<boolean>;
  /** The last stall the rule loop recorded for the track's project since `since` (ms). */
  stall(since: number): { class: StallClass; evidence: string } | undefined;
}

export interface TrackResult {
  pass: boolean;
  /** Minutes the run took. */
  minutes: number;
  stages: { stage: Stage; minutes: number }[];
  /** Where it broke, and the class and evidence of the stall that broke it. */
  broke?: { stage: Stage; class: StallClass; evidence: string };
}

/** Drives the chain one stage at a time; each stage is looked at every `poll` ms until its limit. */
export async function runTrack(w: TrackWorld, poll = 15_000): Promise<TrackResult> {
  const start = w.now();
  const stages: TrackResult["stages"] = [];
  const done = (broke?: TrackResult["broke"]): TrackResult => ({
    pass: broke === undefined,
    minutes: Math.round((w.now() - start) / MIN),
    stages,
    ...(broke ? { broke } : {}),
  });
  for (const stage of STAGES) {
    const from = w.now();
    const err = await w.act(stage).catch((e) => String(e?.message ?? e));
    if (err) return done({ stage, class: "command-failed", evidence: `${stage}: ${err}` });
    while (!(await w.reached(stage).catch(() => false))) {
      if (w.now() - from >= STAGE_LIMIT[stage] * MIN) {
        const s = w.stall(from);
        return done({
          stage,
          class: s?.class ?? "no-sign-of-life",
          evidence: s?.evidence ?? `${stage} did not finish within ${STAGE_LIMIT[stage]} min, and the rule loop saw no stall`,
        });
      }
      await w.wait(poll);
    }
    stages.push({ stage, minutes: Math.round((w.now() - from) / MIN) });
  }
  return done();
}

const TRACK_PROJECT = TEST_PROJECT;

const trackDir = (env = process.env) => join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "lineclear-track");
export const trackLog = (env = process.env) => join(configDir(env), "track.jsonl");

const SEED_ROADMAP = `# Roadmap

The test track's fixture: each run plans one step here, works it and merges it, then the track puts this file back.

## Phase 0: the seed

### T0 The seed
- why: a roadmap needs a step to plan after.
- done when:
  - README.md says what the fixture is.
- locks: ui
- after: none
`;

/** The two cheapest models of the self project's lists, by price per token in pi's models store; unpriced ones last. */
export function cheapest(models: string[], price: (m: string) => number | undefined): string[] {
  return [...new Set(models)]
    .map((m, i) => ({ m, i, p: price(m) ?? Infinity }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .slice(0, 2)
    .map((x) => x.m);
}

/** The cheapest reviewer of the self project from another company than the track's planner: the step check of a plan needs one. */
export function trackReviewer(planner: string, reviewers: string[], price: (m: string) => number | undefined): string | undefined {
  return [...new Set(reviewers)].filter((m) => company(m) !== company(planner)).sort((a, b) => (price(a) ?? Infinity) - (price(b) ?? Infinity))[0];
}

function trackGit(args: string[], cwd: string): string {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "track",
    GIT_AUTHOR_EMAIL: "track@lineclear",
    GIT_COMMITTER_NAME: "track",
    GIT_COMMITTER_EMAIL: "track@lineclear",
  };
  const r = gitWith({ env }, cwd, ...args);
  if (!r.ok) throw new Error(`git ${args[0]} failed: ${r.err}`);
  return r.out.trim();
}

/** The fixture repo and its origin, made once; each run puts main back to the seed so nothing grows. */
function resetFixture(env = process.env): string {
  const dir = trackDir(env);
  const origin = join(dir, "origin.git");
  const repo = join(dir, "repo");
  if (!existsSync(join(origin, "HEAD"))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    trackGit(["init", "-q", "--bare", "-b", "main", origin], dir);
    trackGit(["clone", "-q", origin, repo], dir);
    mkdirSync(join(repo, "docs"), { recursive: true });
    writeAtomic(join(repo, "README.md"), "# The test track\n\nA fixture Lineclear works on every night to see the whole chain run.\n");
    writeAtomic(join(repo, "docs", "ROADMAP.md"), SEED_ROADMAP);
    writeAtomic(join(repo, "package.json"), `${JSON.stringify({ name: "lineclear-track", private: true, scripts: { check: "true" } }, null, 2)}\n`);
    trackGit(["checkout", "-q", "-b", "main"], repo);
    trackGit(["add", "-A"], repo);
    trackGit(["commit", "-q", "-m", "T0: the seed"], repo);
    trackGit(["push", "-q", "origin", "main", "main:seed"], repo);
  }
  trackGit(["fetch", "-q", "origin"], repo);
  trackGit(["checkout", "-q", "-f", "main"], repo);
  trackGit(["reset", "-q", "--hard", "origin/seed"], repo);
  trackGit(["clean", "-qfd"], repo);
  trackGit(["push", "-q", "-f", "origin", "main"], repo);
  return repo;
}

const lineclearBin = () => join(import.meta.dir, "..", "bin", "lineclear");

function runCmd(cmd: string[], env = process.env, timeout = 120_000): string | undefined {
  const p = Bun.spawnSync(cmd, { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: env as Record<string, string>, timeout });
  return p.exitCode === 0 ? undefined : (p.stderr.toString() || p.stdout.toString()).trim().split("\n").slice(-2).join(" ") || `${cmd[0]} exited ${p.exitCode}`;
}

/** `project add` for the fixture; it passes the space, which a fresh folder cannot be detected from. */
export const trackAddCommand = (repo: string, worker: string[], reviewer: string[], planner: string): string[] => [
  lineclearBin(),
  "project",
  "add",
  repo,
  "--name",
  TRACK_PROJECT,
  "--space",
  TRACK_PROJECT,
  "--check",
  "true",
  "--ask-plans",
  "off",
  "--worker",
  worker.join(","),
  "--reviewer",
  reviewer.join(","),
  "--planner",
  planner,
];

/** The board's space for the fixture, made when it is missing: the settings can outlive the space, and `plan` needs it. */
export function ensureTrackSpace(repo: string, env = process.env): string | undefined {
  const bin = serverBin(env);
  const list = Bun.spawnSync([bin, "space", "list"], { stdin: "ignore", stdout: "pipe", stderr: "ignore", env: env as Record<string, string> });
  if (
    list.exitCode === 0 &&
    list.stdout
      .toString()
      .split("\n")
      .some((l) => l.trim().split(/\s{2,}/)[0] === TRACK_PROJECT)
  )
    return undefined;
  const err = runCmd([bin, "space", "add", repo, "--name", TRACK_PROJECT], env);
  return err ? `could not add the track's space: ${err}` : undefined;
}

/** Where no project is Lineclear's own there is nothing to test: the track skips, and its unit does not fail. */
const NO_CHECKER = "no step checker for the track's plans";
const NO_SELF = `no project is Lineclear's own (set "self": true in its settings)`;

/** The fixture as a project on the cheapest models: plans apply by themselves, its check passes at once. */
export function trackProject(repo: string, env = process.env): { space: string; worker: string[] } | string {
  const self = selfProject(env);
  if (!self) return NO_SELF;
  const per = modelPrice(env);
  const two = cheapest([...self.settings.models.worker, ...self.settings.models.reviewer], per);
  const first = two[0];
  if (first === undefined) return "the self project lists no models";
  const other = trackReviewer(first, self.settings.models.reviewer, per);
  if (!other) return `${NO_CHECKER}: the self project has no reviewer from another company than ${first}`;
  const reviewer = [...new Set([other, ...two])];
  if (typeof readSettings(TRACK_PROJECT, env) === "string") {
    const err = runCmd(trackAddCommand(repo, two, reviewer, first), env);
    if (err) return `could not add the track's project: ${err}`;
  }
  const spaceErr = ensureTrackSpace(repo, env);
  if (spaceErr) return spaceErr;
  const s = changeSettings(TRACK_PROJECT, { models: { worker: two, reviewer, planner: [first] }, askBefore: { plans: false } }, env);
  if (typeof s === "string") return s;
  return { space: s.space, worker: two };
}

const RESTART = `systemctl --user restart lineclear.service && for u in $(systemctl --user list-units --state=active --plain --no-legend 'lineclear-serve-*.service' | awk '{print $1}'); do systemctl --user restart "$u"; done`;

const stepIds = (text: string) => [...text.matchAll(/^### (\S+)/gm)].map((m) => m[1] ?? "");

/** The real world: the CLI, the server and the fixture repo. */
function realTrack(repo: string, space: string, worker: string[], stamp: string, env = process.env): TrackWorld {
  let step: string | undefined;
  let task: { id?: string; status: string; sub?: string } | undefined;
  const mine = () => {
    const all = lineclearTasks(space, env);
    if (typeof all === "string" || step === undefined) return undefined;
    return all.filter((t) => t.title.startsWith(`${step} `) || t.title === step).at(-1);
  };
  const mainSubjects = () => {
    trackGit(["fetch", "-q", "origin"], repo);
    return trackGit(["log", "origin/main", "--format=%s"], repo).split("\n");
  };
  return {
    now: () => Date.now(),
    wait: (ms) => Bun.sleep(ms),
    act: async (stage) => {
      if (stage === "request")
        return runCmd([lineclearBin(), "plan", TRACK_PROJECT, `Add the file runs/${stamp}.txt that says "track ${stamp}". One step, no other change.`], env);
      if (stage === "restart") {
        // as an update does: the rule loop and the board's server (install.sh's restart_all)
        const err = runCmd(["sh", "-c", RESTART], env);
        return err ? `the service restart failed: ${err}` : undefined;
      }
      if (stage === "switch") {
        const model = worker[1] ?? worker[0];
        if (!model) return "no worker model to switch to";
        return task?.id ? runCmd([serverBin(env), "restart", task.id, "--agent", "pi", "--model", model], env) : "no task to switch";
      }
      return undefined;
    },
    reached: async (stage) => {
      if (stage === "request" || stage === "switch") return true;
      if (stage === "plan") {
        trackGit(["fetch", "-q", "origin"], repo);
        const ids = stepIds(trackGit(["show", "origin/main:docs/ROADMAP.md"], repo)).filter((id) => id !== "T0");
        step = ids[0];
        return step !== undefined;
      }
      task = mine();
      if (stage === "start") return task?.status === "work";
      if (stage === "restart")
        return runCmd([serverBin(env), "task", "list", "--json"], env, 10_000) === undefined && task !== undefined && task.status !== "closed";
      if (stage === "work") return task !== undefined && (task.status === "done" || /review|ready/i.test(task.sub ?? ""));
      if (stage === "review") return task !== undefined && (task.status === "done" || /ready|merg/i.test(task.sub ?? ""));
      const id = task?.id;
      return task?.status === "done" && mainSubjects().some((s) => s.startsWith(`${step}:`) || (id !== undefined && s.includes(id)));
    },
    stall: (since) => {
      const d = readDecisionsSince(decisionsPath(env), since)
        .filter((x) => x.project === TRACK_PROJECT && x.event === "stall" && typeof x.class === "string")
        .at(-1);
      return d ? { class: d.class as StallClass, evidence: `${d.time} ${d.step ?? "-"}: ${d.reason}` } : undefined;
    },
  };
}

const KEEP_RUNS = 400;

const USAGE = "usage: lineclear track [--after-update] [--json]";

/** `lineclear track`: one run of the test track. Exit 0 on a pass, 1 when it broke. */
export interface TrackDeps {
  /** The chain to drive: the real one when not given. */
  track?: TrackWorld;
  /** The rule loop's world the fix is filed in. */
  rules?: World;
  rollBack?: (why: string) => string;
}

export async function trackMain(args: string[], out: (l: string) => void, env = process.env, deps: TrackDeps = {}): Promise<number> {
  const after = args.includes("--after-update");
  const json = args.includes("--json");
  if (args.some((a) => a !== "--after-update" && a !== "--json")) {
    out(USAGE);
    return 2;
  }
  const lock = join(configDir(env), "track.lock");
  if (existsSync(lock) && Date.now() - Number(readFileSync(lock, "utf8")) < 4 * 60 * MIN) {
    out("lineclear track: a run is already going");
    return 1;
  }
  mkdirSync(configDir(env), { recursive: true });
  writeAtomic(lock, String(Date.now()));
  let result: TrackResult;
  try {
    if (deps.track) result = await runTrack(deps.track);
    else {
      const repo = resetFixture(env);
      const p = trackProject(repo, env);
      if (typeof p === "string" && !p.startsWith(NO_CHECKER)) {
        out(`lineclear track: ${p}`);
        return p === NO_SELF ? 0 : 1;
      }
      if (typeof p === "string") result = { pass: false, minutes: 0, stages: [], broke: { stage: "request", class: "command-failed", evidence: p } };
      else {
        changeSettings(TRACK_PROJECT, { paused: false }, env);
        try {
          result = await runTrack(realTrack(repo, p.space, p.worker, new Date().toISOString().replace(/[-:]/g, "").slice(0, 13), env));
        } finally {
          // between runs the rules leave the fixture alone
          changeSettings(TRACK_PROJECT, { paused: true }, env);
        }
      }
    }
  } finally {
    rmSync(lock, { force: true });
  }
  const line = { time: new Date().toISOString(), afterUpdate: after, ...result };
  appendFileSync(trackLog(env), `${JSON.stringify(line)}\n`);
  // a year of nights is kept, no more
  const runs = readFileSync(trackLog(env), "utf8").trimEnd().split("\n");
  if (runs.length > KEEP_RUNS) writeAtomic(trackLog(env), `${runs.slice(-KEEP_RUNS).join("\n")}\n`);
  if (json) out(JSON.stringify(line));
  else if (result.pass) out(`track: pass in ${result.minutes} min`);
  else if (result.broke) out(`track: broke at ${result.broke.stage}: ${CLASS_INFO[result.broke.class].label} (${result.broke.evidence})`);
  const broke = result.broke;
  if (result.pass || !broke) return 0;
  const evidence = [`test track ${after ? "after an update " : ""}broke at ${broke.stage}: ${broke.evidence}`];
  out(`track: ${fileFixNow(deps.rules ?? realWorld(env), broke.class, evidence, env)}`);
  const why = `the test track broke at ${broke.stage} (${CLASS_INFO[broke.class].label})`;
  if (after) out(`track: ${(deps.rollBack ?? ((w) => rollBack(w, env)))(why)}`);
  return 1;
}

/** Puts the version before the update back, with install.sh's own rollback. */
function rollBack(why: string, env = process.env): string {
  const err = runCmd(["sh", join(import.meta.dir, "..", "install.sh")], { ...env, LINECLEAR_ROLLBACK: why }, 600_000);
  return err ? `the rollback failed: ${err}` : "rolled back to the version before the update";
}
