import { readJson } from "../pi/config.ts";
import { IDLE_TEXT } from "./cards.ts";
import { farTasks } from "./far-tasks.ts";
import { IDLE_CARD, lastCards, stageSince, stepOf, type TaskRecord, taskStage, taskState } from "./home-stage.ts";
import { laneNote } from "./lane-note.ts";
import { readTasksKept, retiredCounts } from "./tasks-kept.ts";
import { dataDir } from "./paths.ts";
import { existsSync, readdirSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { type Blocker, countSteps, readPlan, type Where } from "./progress.ts";
import { lineOf, type RoadmapLine } from "./roadmap-line.ts";
import { roadmapSource, lineclearAllTasks } from "./roadmap-source.ts";
import { planInputs, titledByStep } from "./task-steps.ts";
import { keptBy, readJsonKept, refsKey } from "./kept-read.ts";
import { spaceStops, waitBlocker, waitingOf } from "./home-waits.ts";
import { machineTasksShown } from "./task-read.ts";
import { readWaits, type Wait, type WaitGroup, waitsForOwner } from "./waits.ts";
import { type Move, readMoves } from "./full.ts";
import { listProjectNames, readSettings } from "./project.ts";
import { mainRefs } from "./main-branch.ts";
import { rowFacts } from "./task-detail.ts";
import { DAY } from "./time.ts";
import { worktreeInput } from "./measure.ts";
import { gitText } from "./git.ts";

/** A space as spaces.json keeps it. */
interface SpaceRecord {
  name: string;
  key: string;
  path: string;
  github?: string;
}

/** What Home draws. Built from Lineclear's files, pi's session files and git, with no AI. */
export interface HomeData {
  at: number;
  host: string; // this machine: the machine of a task that names none
  projects: HomeProject[];
  /** Open tasks of spaces no project points at, so no running work hides. */
  loose?: LooseTask[];
  /** The last tasks that moved to another model because their account was full, newest first. */
  moves?: Move[];
  /** How many requests the Planner is laying steps for now. */
  planning?: number;
  /** The Dispatcher works on an answer now: its signal box shows writing dots. */
  dispatcher?: { writing: boolean };
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
  /** When the task was created (ms): the start of its run time. */
  started?: number;
  /** Tokens sent to the model so far: fresh and cache reads. */
  input?: number;
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
function displayName(space: SpaceRecord, names: Record<string, string>, machine: string): string {
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
  const spaces: SpaceRecord[] = readJson(join(dir, "spaces.json")) ?? [];
  const file = readTasksKept(dir);
  const tasks = (file.tasks ?? []) as TaskRecord[];
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
  const strays: SpaceRecord[] = [];
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
  // tasks the server retired after 90 days are counted by space key
  const retired = retiredCounts(dir);
  const ctx: SpaceContext = { tasks, red, names, machine, waits, honest, cards, every, retired, env, now };
  // one line per project of `lineclear project list`, whatever the server holds: a space two projects share shows twice, a missing one empty
  const lines = [...spaces, ...strays].flatMap((s) => (owners.get(s.name) ?? [undefined]).map((owner) => spaceView(s, ctx, owner)));
  // a project whose settings do not read is still in `project list`: it shows as an empty line
  return [...lines, ...unreadable.map((n) => spaceView({ name: n, key: "", path: "" }, ctx, { project: n, paused: false }))];
}

interface SpaceContext {
  tasks: TaskRecord[];
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

type Roadmap = ReturnType<typeof roadmapProgress>;

/** The tokens an agent sent to the model so far, from its session logs, read again at most every 30 s. */
function liveStatus(t: TaskRecord, env: Env, now: number): { input?: number } {
  if (typeof t.worktree !== "string" || t.machine) return {};
  const worktree = t.worktree;
  return keptBy(`status:${worktree}`, String(Math.floor(now / 30_000)), () => {
    const input = worktreeInput(worktree, env);
    return input === undefined ? {} : { input };
  });
}

/** One of this machine's tasks as the home view shows it. */
function localRow(x: { t: TaskRecord; state: TaskState }, roadmap: Roadmap, line: string | undefined, ctx: SpaceContext): HomeTask {
  const { t, state } = x;
  const { cards, env, now } = ctx;
  const title = String(t.title ?? t.id);
  const step = t.step ?? stepOf(title);
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
    ...(typeof t.created === "number" ? { started: t.created } : {}),
    ...(stage === "work" || stage === "review" ? liveStatus(t, env, now) : {}),
    ...(state !== "done" ? rowFacts(t, cards.get(t.id), stage !== "queued", now) : {}),
    ...(stage === "work" && typeof t.report?.progress === "number" ? { progress: Math.max(0, Math.min(1, t.report.progress / 100)) } : {}),
    // Lineclear keeps `stalled` after a stall ends; `life` is set only while the task is still quiet
    ...(typeof t.stalled?.life === "number" && (stage === "work" || stage === "review") ? { stalled: true } : {}),
    // the row shows `last`, so the lane's word takes its place; a hanging head is stuck, whatever its stage
    ...(lane !== undefined ? { lane, last: { text: lane, at: now }, ...(lane.startsWith("Stuck") ? { stalled: true } : {}) } : {}),
    at: t.doneAt ?? t.updated ?? t.created ?? now,
    ...(text !== undefined ? { text } : {}),
  };
}

/** One space as a project on the home view. */
function spaceView(s: SpaceRecord, ctx: SpaceContext, owner?: { project: string; paused: boolean }): HomeProject {
  const { env, now, waits } = ctx;
  // a red mark counts only while it is the head of main
  const head = existsSync(s.path) ? mainHead(s.path) : undefined;
  const broken = head !== undefined && ctx.red[s.path] !== undefined && ctx.red[s.path] === head;
  const every = ctx.every;
  const listed = typeof every === "string" ? every : [...every.filter((t) => String(t.id).startsWith(`${s.key}-`)), ...machineTasksShown(env, s.name)];
  const lines = new Map(typeof listed === "string" ? [] : listed.flatMap((t) => (t.id && t.sub ? [[t.id, t.sub] as const] : [])));
  const status = new Map(typeof listed === "string" ? [] : listed.flatMap((t) => (t.id ? [[t.id, t.status] as const] : [])));
  // a turn that ended with no question and no declared wait is not Needs you: the stall ladder resumes it
  const quiet = (id: string, state: TaskState | undefined) =>
    state === "need" &&
    lines.get(id) === IDLE_TEXT &&
    IDLE_CARD.test(ctx.cards.get(id)?.text ?? IDLE_TEXT) &&
    !waits.some((w) => w.task === id && waitsForOwner(w))
      ? "work"
      : state;
  const own = ctx.tasks
    .filter((t) => String(t.id).startsWith(`${s.key}-`))
    .map((t) => ({ t, state: quiet(t.id, taskState(t, status.get(t.id))) }))
    .filter((x): x is { t: TaskRecord; state: TaskState } => x.state !== undefined);
  const open = own.filter((x) => x.state !== "done");
  const done = own.filter((x) => x.state === "done").sort((a, b) => (b.t.doneAt ?? b.t.updated ?? 0) - (a.t.doneAt ?? a.t.updated ?? 0));
  const merged7 = done.filter((x) => (x.t.doneAt ?? x.t.updated ?? 0) >= now - 7 * DAY).length;
  const roadmap = existsSync(s.path)
    ? roadmapProgress(
        s.path,
        spaceStops(s.key, waits),
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

/** What a space is called in a URL: lower case words joined by dashes, at most 80 characters. */
const spaceSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

/** The space of this machine whose slug it is, when exactly one has it. */
export function localSpaceBySlug(slug: string, env: Env = process.env): { name: string; path: string; key?: string } | undefined {
  const spaces: SpaceRecord[] = readJson(join(dataDir(env), "spaces.json")) ?? [];
  const hits = spaces.filter((s) => typeof s.name === "string" && typeof s.path === "string" && spaceSlug(s.name) === slug);
  const [hit] = hits;
  return hits.length === 1 && hit ? { name: hit.name, path: hit.path, key: hit.key } : undefined;
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

/** Every space of this machine with its tasks; waiting tasks read all of them. */
export function projectsData(env: Env = process.env, now = Date.now()): HomeProject[] {
  return machineSpaces(dataDir(env), env, now);
}

export function homeData(env: Env = process.env, now = Date.now()): HomeData {
  const all = projectsData(env, now);
  return {
    at: now,
    host: hostname(),
    projects: withProject(all),
    loose: looseTasks(all),
    moves: readMoves(env as NodeJS.ProcessEnv, 5),
  };
}
