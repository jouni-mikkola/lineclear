import { readJson } from "../pi/config.ts";
import { questionIn } from "./cards.ts";
import { dataDir } from "./paths.ts";
import type { ReleaseState } from "./release.ts";
import { existsSync, readdirSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { type Blocker, countSteps, lineOf, readPlan, type RoadmapLine, type Where } from "./progress.ts";
import { roadmapSource, lineclearAllTasks } from "./roadmap-source.ts";
import { planInputs, titledByStep } from "./task-steps.ts";
import { keptBy, readJsonKept, readTasksKept, refsKey } from "./kept-read.ts";
import { spaceStops, waitBlocker, waitingOf } from "./home-waits.ts";
import { notReached, remoteTasks } from "./spread.ts";
import { type Export, remoteExports } from "./remotes.ts";
import { readWaits, type Wait, type WaitGroup, waitsForOwner } from "./waits.ts";
import { type AccountUse, usageLimits } from "./limits.ts";
import { type Move, readAccounts, readMoves } from "./full.ts";
import { listProjectNames, readSettings } from "./project.ts";
import { mainRefs } from "./main-branch.ts";
import { rowFacts } from "./task-detail.ts";
import { type MonthSpend, type PiSpend, monthSpend, piSpendAndUsage } from "./home-spend.ts";
import { DAY } from "./time.ts";
import { gitText } from "./git.ts";

/** A parsed file or event read as it is: its shape is not ours to promise. */
type Raw = any;

export { type PiSpend, monthSpend, piSpendAndUsage, spendAndUsage } from "./home-spend.ts";

/** What Home draws. Built from Lineclear's files, pi's session files and git, with no AI. */
export interface HomeData {
  at: number;
  host: string; // this machine: the machine of a task that names none
  projects: HomeProject[];
  /** Open tasks of spaces no project points at, so no running work hides. */
  loose?: LooseTask[];
  /** How full each account's session and week limits are. */
  usage: AccountUse[];
  /** The last tasks that moved to another model because their account was full, newest first. */
  moves?: Move[];
  /** The equivalent $ of each of the last 14 days, oldest first. */
  spend: { day: string; dollars: number }[];
  /** This calendar month (UTC): what the subscriptions cost and what the same tokens cost at API list prices. */
  month?: MonthSpend;
  /** How many requests the Planner is laying steps for now. */
  planning?: number;
  /** The Dispatcher works on an answer now: its signal box shows writing dots. */
  dispatcher?: { writing: boolean };
  /** Stable and next, once the rule loop has looked at main (`lineclear release`). */
  release?: ReleaseState;
  /** What `lineclear doctor` finds wrong on this machine, each as "problem: fix command". */
  doctor?: string[];
}

export type TaskState = "queued" | "work" | "need" | "done";
/** Where a task is on the line: in line for the rules, at work, in review, ready to merge, or merged. */
export type Stage = "queued" | "work" | "review" | "ready" | "done";

export interface HomeTask {
  id: string;
  /** The full title: the roadmap step's when the task names one, else the task's own. */
  title: string;
  state: TaskState;
  stage: Stage;
  /** The roadmap step id the task's title starts with, such as "U20". */
  step?: string;
  /** What the step gives, in one sentence: the roadmap step's result. */
  result?: string;
  /** The model of the role at work now: the worker's, or the reviewer's in review. */
  model?: string;
  /** Since when the task is at its stage (ms). */
  since: number;
  /** The other machine the task runs on, when it is not this one. */
  machine?: string;
  /** Lineclear saw no sign of life from it. */
  stalled?: boolean;
  /** The merge lane's word on it: a head stuck in a step, or "Released from the merge line: <reason>". */
  lane?: string;
  last?: { text: string; at: number };
  files?: number;
  check?: "pass" | "fail";
  /** How far its worker says it is, 0 to 1, from its last status report. */
  progress?: number;
  at: number;
  text?: string;
  /** Its machine did not answer the last read: when it last did (ms). The row says so and the task counts as waiting for no one. */
  silentSince?: number;
}

/** Why work waits in a project, in words: what runs now, what each paused task waits for, why a ready step has not started. */
export interface HomeWaiting {
  running: { id: string; title: string; stage: Stage; since: number }[];
  paused: WaitGroup[];
  notStarted: { title: string; reason: string }[];
}

export interface HomeProject extends Where {
  /** The space's display name, or its repo's name: never the folder's old name. */
  name: string;
  /** The space's own name, which a project's settings point at. */
  space?: string;
  /** Its progress: roadmap steps done of all, or merged tasks of all when it has no roadmap. */
  done: number;
  total: number;
  unit: "steps" | "tasks";
  /** Main is red now: its red commit is the head of main. */
  broken: boolean;
  /** Open tasks first, then the last few done. */
  tasks: HomeTask[];
  /** The roadmap in one line, the same the roadmap view and `lineclear roadmap status` give. */
  line?: RoadmapLine;
  /** The machine that runs it, when it is not this one. */
  machine?: string;
  /** The Lineclear project whose roadmap view shows this project, when one has its space. */
  roadmap?: string;
  /** The Lineclear project that has its space, and whether it is Paused (the rules start none of its steps). */
  project?: string;
  paused?: boolean;
  waiting: HomeWaiting;
}

/** An open task of a space with no project, with the space's name. */
export interface LooseTask extends HomeTask {
  space: string;
}

export type Env = Record<string, string | undefined>;

/**
 * The state of one Lineclear task: from `lineclear task list` (`listed` is its status there) where it can say, else from
 * what the task was last told. A chat card never decides it.
 */
export function taskState(task: Raw, listed: string | undefined): TaskState | undefined {
  if (task.closed && !task.merged) return undefined;
  if (task.merged || task.told === "done" || listed === "done") return "done";
  if (listed === "need" || listed === "work") return listed;
  if (listed === undefined && (task.told === "work" || task.told === "merging")) return "work";
  return "queued";
}

/** A roadmap step id at the start of a task's title, as the rules name the tasks they start: "U20 The line". */
export const stepOf = (title: string) => /^([A-Z][A-Za-z]{0,3}\d+[a-z]?)\s/.exec(title)?.[1];

/**
 * Where a task is on the line. Ready once it reported ready and is not merged; in review while its status line
 * says so; else its state.
 */
export function taskStage(task: Raw, state: TaskState, line?: string): Stage {
  if (state === "done") return "done";
  if (state === "queued") return "queued";
  if (task.reported === true) return "ready";
  if (/\breview/i.test(line ?? task.report?.msg ?? "")) return "review";
  return "work";
}

// when each task was first seen at its stage, as long as this process runs
const seen = new Map<string, { stage: Stage; since: number }>();

/** Since when a task is at its stage: its creation in line, its merge, else the first read that saw it there. */
export function stageSince(task: Raw, stage: Stage, now: number): number {
  const was = seen.get(task.id);
  const since = was?.stage === stage ? was.since : stage === "queued" ? (task.created ?? now) : stage === "done" ? (task.doneAt ?? task.updated ?? now) : now;
  seen.set(task.id, { stage, since });
  return since;
}

/** The last card of each task, with its time, from Lineclear's chat files. */
export function lastCards(files: Raw[]): Map<string, { at: number; text: string }> {
  const last = new Map<string, { at: number; text: string }>();
  for (const f of files) {
    for (const p of f?.posted ?? []) {
      const task = p?.card?.task;
      if (typeof task !== "string" || typeof p.at !== "number" || typeof p.card.text !== "string") continue;
      // a plain-text question of an agent shows as the card's line, not the status word
      const asked = /^(?:needs you:\s*)?Waits for your reply$/i.test(p.card.text) ? questionIn(String(p.card.ask?.reply?.text ?? "")) : undefined;
      if ((last.get(task)?.at ?? -1) <= p.at) last.set(task, { at: p.at, text: asked ?? p.card.text });
    }
  }
  return last;
}

/** The head of main in a folder, or undefined when it has none. */
const mainHead = (repo: string) => {
  const read = () => {
    const [origin, main] = mainRefs(repo);
    return gitText(repo, "rev-parse", main) ?? gitText(repo, "rev-parse", origin);
  };
  const key = refsKey(repo);
  return key === undefined ? read() : keptBy(`head:${repo}`, key, read);
};

/** What a space is called: its name in Lineclear's names file, else its repo's name, else its folder's name. */
function displayName(space: Raw, names: Record<string, string>, machine: string): string {
  const named = names[`p:${machine}:${space.name}`];
  if (typeof named === "string" && named.trim()) return named.trim();
  const repo =
    typeof space.github === "string"
      ? space.github
          .split("/")
          .filter(Boolean)
          .at(-1)
          ?.replace(/\.git$/, "")
      : undefined;
  return repo || space.name;
}

function roadmapProgress(
  repo: string,
  waits: Blocker[],
  marks: StepMarks,
  merged7: number,
  now: number,
  env: NodeJS.ProcessEnv,
): ({ done: number; total: number; line: RoadmapLine; titles: Map<string, string>; open: Set<string>; results: Map<string, string> } & Where) | undefined {
  const source = roadmapSource(repo);
  if (!source) return undefined;
  const { merged, unproven } = planInputs(source.text, source.commits, repo, env);
  const plan = readPlan(source.text, source.commits, unproven, merged);
  if (plan.steps.length === 0) return undefined;
  const { line, where } = lineOf(source.text, source.commits, marks, waits, now, merged7, unproven, merged);
  return {
    ...countSteps(plan),
    ...where,
    line,
    open: new Set(plan.steps.filter((s) => !s.done).map((s) => s.id)),
    titles: new Map(plan.steps.map((s) => [s.id, s.title])),
    results: new Map(plan.steps.flatMap((s) => (s.result ? [[s.id, s.result] as [string, string]] : []))),
  };
}

type StepMarks = Map<string, "work" | "need">;

/** Which roadmap steps have a task that is open: at work, or waiting for you. Home and the roadmap's line count the same. */
export function stepMarks(tasks: { title: string; status: string }[]): StepMarks {
  return new Map(
    tasks.flatMap((t) => (stepOf(t.title) ? [[stepOf(t.title) as string, t.status === "need" ? ("need" as const) : ("work" as const)] as const] : [])),
  );
}

/** A machine's own folder: its spaces, tasks and chat files. */
function machineSpaces(dir: string, env: Env, now: number): HomeProject[] {
  const spaces: Raw[] = readJson(join(dir, "spaces.json")) ?? [];
  const file = readTasksKept(dir);
  const tasks: Raw[] = file.tasks ?? [];
  const red: Record<string, string> = file.red ?? {};
  const names: Record<string, string> = readJson(join(dir, "names.json")) ?? {};
  const machine = hostname();
  const waits = readWaits(env);
  const honest = new Map(waits.filter((w) => !waitsForOwner(w)).map((w) => [w.task, waitBlocker(w).text] as const));
  const log = join(dir, "chatlog");
  const chats = existsSync(log)
    ? readdirSync(log)
        .filter((f) => f.endsWith(".json"))
        .map((f) => readJsonKept<object>(join(log, f)))
    : [];
  const cards = lastCards(chats);
  const owners = new Map<string, { project: string; paused: boolean }[]>();
  const strays: Raw[] = [];
  const unreadable: string[] = [];
  for (const n of listProjectNames(env as NodeJS.ProcessEnv)) {
    const p = readSettings(n, env as NodeJS.ProcessEnv);
    if (typeof p === "string") {
      unreadable.push(n);
      continue;
    }
    owners.set(p.space, [...(owners.get(p.space) ?? []), { project: n, paused: p.paused === true }]);
    if (!spaces.some((s) => s.name === p.space)) strays.push({ name: p.space, key: "", path: p.repo });
  }
  const every = spaces.length ? lineclearAllTasks(env) : [];
  // tasks the server retired after 90 days are counted in archive/counts.json, by space key
  const retired = readJsonKept<Record<string, { merged: number; closed: number }>>(join(dir, "archive", "counts.json")) ?? {};
  const ctx: SpaceContext = { tasks, red, names, machine, waits, honest, cards, every, retired, env, now };
  // one line per project of `lineclear project list`, whatever the server holds: a space two projects share shows twice, a missing one empty
  const lines = [...spaces, ...strays].flatMap((s) => (owners.get(s.name) ?? [undefined]).map((owner) => spaceView(s, ctx, owner)));
  // a project whose settings do not read is still in `project list`: it shows as an empty line
  return [...lines, ...unreadable.map((n) => spaceView({ name: n, key: "", path: "" }, ctx, { project: n, paused: false }))];
}

interface SpaceContext {
  tasks: Raw[];
  red: Record<string, string>;
  names: Record<string, string>;
  machine: string;
  waits: Wait[];
  honest: Map<string, string>;
  cards: ReturnType<typeof lastCards>;
  every: ReturnType<typeof lineclearAllTasks>;
  retired: Record<string, { merged: number; closed: number }>;
  env: Env;
  now: number;
}

/** A remote task's state line without the "on <machine>" tail the spread adds (`parseRoom` in spread.ts). */
const withoutTail = (sub: string | undefined) => sub?.replace(/(?: · )?on [^ ]+$/, "") || undefined;

/** Tasks that run on the project's other machines show beside the local ones. */
function farTasks(space: Raw, env: Env, now: number): HomeTask[] {
  return remoteTasks(space.name, env)
    .filter((t) => t.id && (t.status === "work" || t.status === "need" || t.status === "queued"))
    .map((t): HomeTask => {
      // a silent machine's task is only what it said last: it is not waiting for you now
      const state = (t.silentSince !== undefined && t.status === "need" ? "work" : t.status) as TaskState;
      const step = stepOf(t.title);
      const line = withoutTail(t.sub);
      const stage = taskStage({}, state, line);
      const since = stageSince({ id: String(t.id) }, stage, now);
      return {
        id: String(t.id),
        title: t.title,
        state,
        stage,
        ...(state === "need" && line ? { text: line } : {}),
        ...(step ? { step } : {}),
        machine: String(t.id).split("@")[1],
        since,
        at: since,
        ...(t.silentSince !== undefined
          ? {
              silentSince: t.silentSince,
              last: {
                text: notReached(String(t.id).split("@")[1] ?? "", t.silentSince),
                at: t.silentSince,
              },
            }
          : {}),
      };
    });
}

type Roadmap = ReturnType<typeof roadmapProgress>;

/** One of this machine's tasks as the home view shows it. */
function localRow(x: { t: Raw; state: TaskState }, roadmap: Roadmap, line: string | undefined, ctx: SpaceContext): HomeTask {
  const { t, state } = x;
  const { cards, env, now } = ctx;
  const title = String(t.title ?? t.id);
  const step = stepOf(title);
  const full = step && roadmap?.titles.get(step);
  const result = step && roadmap?.results.get(step);
  const stage = taskStage(t, state, line);
  const lane = state === "done" ? undefined : laneNote(t, now);
  const model = (stage === "review" ? t.reviewer?.model : t.agent?.model) as unknown;
  // a machine wait (a task, a check slot, a time, a failed start) is said as it is, never as the agent's last line to you
  const text = state === "need" ? (ctx.honest.get(t.id) ?? cards.get(t.id)?.text) : undefined;
  return {
    id: t.id,
    title: full ? `${step} ${full}` : title,
    state,
    stage,
    ...(step ? { step } : {}),
    ...(result ? { result } : {}),
    ...(typeof model === "string" && stage !== "queued" ? { model } : {}),
    since: stageSince(t, stage, now),
    ...(state !== "done" ? rowFacts(t, cards.get(t.id), stage !== "queued", env, now) : {}),
    ...(stage === "work" && typeof t.report?.progress === "number" ? { progress: Math.max(0, Math.min(1, t.report.progress / 100)) } : {}),
    // Lineclear keeps `stalled` after a stall ends; `life` is set only while the task is still quiet
    ...(typeof t.stalled?.life === "number" && (stage === "work" || stage === "review") ? { stalled: true } : {}),
    // the row shows `last`, so the lane's word takes its place; a hanging head is stuck, whatever its stage
    ...(lane !== undefined ? { lane, last: { text: lane, at: now }, ...(lane.startsWith("Stuck") ? { stalled: true } : {}) } : {}),
    at: t.doneAt ?? t.updated ?? t.created,
    ...(text !== undefined ? { text } : {}),
  };
}

/** One space as a project on the home view. */
function spaceView(s: Raw, ctx: SpaceContext, owner?: { project: string; paused: boolean }): HomeProject {
  const { env, now, waits } = ctx;
  // a red mark counts only while it is the head of main
  const head = existsSync(s.path) ? mainHead(s.path) : undefined;
  const broken = head !== undefined && ctx.red[s.path] !== undefined && ctx.red[s.path] === head;
  const every = ctx.every;
  const listed = typeof every === "string" ? every : [...every.filter((t) => String(t.id).startsWith(`${s.key}-`)), ...remoteTasks(s.name, env)];
  const lines = new Map(typeof listed === "string" ? [] : listed.flatMap((t) => (t.id && t.sub ? [[t.id, t.sub] as const] : [])));
  const status = new Map(typeof listed === "string" ? [] : listed.flatMap((t) => (t.id ? [[t.id, t.status] as const] : [])));
  const own = ctx.tasks
    .filter((t) => String(t.id).startsWith(`${s.key}-`))
    .map((t) => ({ t, state: taskState(t, status.get(t.id)) }))
    .filter((x): x is { t: Raw; state: TaskState } => x.state !== undefined);
  const open = own.filter((x) => x.state !== "done");
  const done = own.filter((x) => x.state === "done").sort((a, b) => (b.t.doneAt ?? b.t.updated) - (a.t.doneAt ?? a.t.updated));
  const merged7 = done.filter((x) => (x.t.doneAt ?? x.t.updated ?? 0) >= now - 7 * DAY).length;
  const roadmap = existsSync(s.path)
    ? roadmapProgress(
        s.path,
        spaceStops(s.key, s.path, waits, env),
        stepMarks(
          titledByStep(
            s.path,
            open.map((x) => ({ id: String(x.t.id), title: String(x.t.title), status: x.state })),
            env,
          ),
        ),
        merged7,
        now,
        env,
      )
    : undefined;
  const shown = [
    ...open.map((x) => localRow(x, roadmap, lines.get(x.t.id), ctx)),
    ...farTasks(s, env, now),
    ...done.slice(0, 6).map((x) => localRow(x, roadmap, lines.get(x.t.id), ctx)),
  ];
  const retired = ctx.retired[s.key]?.merged ?? 0;
  return {
    name: displayName(s, ctx.names, ctx.machine),
    space: s.name,
    ...(roadmap ? { phase: roadmap.phase, next: roadmap.next, blocker: roadmap.blocker, finish: roadmap.finish, line: roadmap.line } : {}),
    done: roadmap?.done ?? done.length + retired,
    total: roadmap?.total ?? own.length + retired,
    unit: roadmap ? "steps" : "tasks",
    broken,
    ...owner,
    tasks: shown,
    waiting: waitingOf(shown, own, waits, roadmap, owner?.project, env, now),
  } satisfies HomeProject;
}

/** Home's Usage and Spend cards: spend per day, each account's limits and the last moves. */
export const usageData = (pi: PiSpend, env: Env, now: number): Pick<HomeData, "usage" | "spend" | "moves" | "month"> => ({
  spend: pi.spend,
  month: monthSpend(pi, readAccounts(env as NodeJS.ProcessEnv), now),
  usage: usageLimits(pi.active ?? [], env as NodeJS.ProcessEnv, now),
  moves: readMoves(env as NodeJS.ProcessEnv, 5),
});

/** What a space is called in a URL: lower case words joined by dashes, at most 80 characters. */
const spaceSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

/** The space of this machine whose slug it is, when exactly one has it. */
export function localSpaceBySlug(slug: string, env: Env = process.env): { name: string; path: string; key?: string } | undefined {
  const spaces: Raw[] = readJson(join(dataDir(env), "spaces.json")) ?? [];
  const hits = spaces.filter((s) => typeof s.name === "string" && typeof s.path === "string" && spaceSlug(s.name) === slug);
  return hits.length === 1 ? { name: hits[0].name, path: hits[0].path, key: hits[0].key } : undefined;
}

/** The projects among spaces: a space no project points at is not work to list. */
export const withProject = (all: HomeProject[]): HomeProject[] => all.filter((p) => p.project !== undefined);

/** The open tasks of the spaces no project points at, under their space's name. */
export const looseTasks = (all: HomeProject[]): LooseTask[] =>
  all
    .filter((p) => p.project === undefined)
    .flatMap((p) =>
      p.tasks.filter((t) => t.state !== "done").map((t) => ({ ...t, space: p.name, ...(p.machine && !t.machine ? { machine: p.machine } : {}) })),
    );

/** This machine's spaces with their tasks, from its own folder: every one, so other machines can tell which have work. */
export const localProjects = (env: Env = process.env, now = Date.now()): HomeProject[] => machineSpaces(dataDir(env), env, now);

/** Every space of this machine and what each other machine last said about its own; waiting tasks read all of them. */
export function projectsData(env: Env = process.env, now = Date.now(), remote: Export[] = remoteExports(env, now)): HomeProject[] {
  return [...machineSpaces(dataDir(env), env, now), ...remote.flatMap((e) => e.projects)];
}

export function homeData(env: Env = process.env, now = Date.now(), remote?: Export[]): HomeData {
  const all = projectsData(env, now, remote);
  const usage = usageData(piSpendAndUsage(env, now), env, now);
  return {
    at: now,
    host: hostname(),
    projects: withProject(all),
    loose: looseTasks(all),
    ...usage,
  };
}

if (import.meta.main) console.log(JSON.stringify(homeData(), null, 2));

// The merge lane's stall as the owner reads it: a head that hangs, and a task the lane let go.
/** The lane lets a head go after this long without progress (server/server/live/engine/lane-watch.ts). */
const LANE_IDLE_MS = 15 * 60_000;

/** Steps a head only passes through: a check may run long, these do not. */
const SHORT_STEPS: Record<string, string> = { rebase: "Rebasing", merge: "Merging" };

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/**
 * What the lane says of one task: "Stuck in <step> for <n> min" for a head hanging in a short step, or
 * "Released from the merge line: <reason>" once the lane let it go, until it joins the line again or merges.
 */
function laneNote(task: { landing?: { step?: string; at?: number }; mergeStopped?: string; merged?: boolean }, now: number): string | undefined {
  if (task.merged) return undefined;
  const { landing } = task;
  if (landing) {
    const step = SHORT_STEPS[landing.step ?? ""];
    const quiet = typeof landing.at === "number" ? now - landing.at : 0;
    return step && quiet >= LANE_IDLE_MS ? `Stuck in "${step}" for ${minutes(quiet)} min` : undefined;
  }
  const released = /^Your merge hung in (.*?),? so the merge lane released it/.exec(task.mergeStopped ?? "");
  if (released?.[1]) return `Released from the merge line: hung in ${released[1]}`;
  return task.mergeStopped ? `Merge stopped: ${task.mergeStopped}` : undefined;
}
