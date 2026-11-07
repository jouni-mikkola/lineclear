import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { addDecisions, decisionsSince, pruneDecisions } from "./decisions-store.ts";
import { routeAsks } from "./asks.ts";
import { settlePlans } from "./plan-apply.ts";
import { copyStoreQuietly } from "./store-copies.ts";
import { freshDecisions } from "./decision-dedupe.ts";
import { addItem, answerCard, closeItem, closeSettledUpdates, isOpen, type Item, readItems } from "./inbox.ts";
import { listProjectNames, projectsDir, readSettings, type Settings } from "./project.ts";
import type { Task } from "./roadmap.ts";
import { classify, type StallEntry } from "./stall-class.ts";
import { holdProjectTick, type StartRecord } from "./starts.ts";
import { tickProject } from "./tick-project.ts";
import { sweepDiskUse } from "./disk-use.ts";
import { sweepOldTemp } from "./tmpdirs.ts";
import { holdWorld } from "./hold.ts";
import { DISPATCHER } from "./chat.ts";
import { lineclearServer, postAction, readSnapshot } from "./lineclear-client.ts";
import { dataDir } from "./paths.ts";
import { serviceWaits } from "./wait-service.ts";
import { clearWait, loadLimit, readWaits } from "./waits.ts";
import { ownMark, realWorld, type World } from "./world.ts";
export { ownMark, realWorld };
export type { World };

export const TICK_MS = 30_000;

export interface Decision {
  time: string;
  project: string;
  step?: string;
  kind: "start" | "skip" | "stop" | "wake" | "stall" | "close" | "run";
  reason: string;
  /** The stall class of a stop (src/stall-class.ts). */
  class?: string;
  /** A stall's own lines: it passed its limit, its remedy ran, or it ended. */
  event?: "stall" | "remedy" | "end";
  /** Minutes from the stall to its remedy, or the minutes it cost when it ended, and when the stall began. */
  minutes?: number;
  since?: string;
  /** The machine a failed start was meant for (see start-failures.ts). */
  machine?: string;
}

/** What survives a restart for one project: whether main is red and the last decision per step. */
export interface State extends StartRecord {
  stopped: boolean;
  roadmapErrors: string[];
  last: Record<string, string>;
  /** The stall ladder: per task its rung and the stall cards it has acted on. */
  ladder: Record<string, { rung: number; seen: string[]; asked?: number }>;
  /** The worker model each step runs on, once the loop or the ladder chose it. */
  models: Record<string, string>;
  /** Routine steps started on the cheap model: one leaves the list when its check failed twice and it moved to the worker model. */
  cheap?: string[];
  /** Steps that already had their handover to the next model. */
  handed: string[];
  /** Stall cards older than this (ms) are not acted on. */
  stallSince?: number;
  /** Chat cards already read for a usage limit. */
  limitSeen?: string[];
  /** Per ready step, the ticks in a row it was skipped for locks (see starts.ts). */
  lockWaits?: Record<string, number>;
  /** Each task's start: when first seen (ms), the start ladder's rung and when it last climbed, or that it answered (see starts.ts). */
  starts?: Record<string, { since: number; rung: number; at?: number; acted?: boolean }>;
  /** What each other machine last said about the project's tasks: kept when it cannot be reached, and read by the views. */
  remoteSeen?: Record<string, Task[]>;
  /** Per other machine: when it last answered, whether its last read went unanswered, and whether a day of silence dropped its tasks from the views. */
  machineReads?: Record<string, { good: number; missed?: true; dropped?: true }>;
  /** The project's open stalls, by `<task or step>|<class>`. */
  stalls?: Record<string, StallEntry>;
  /** Steps whose task ended with nothing to merge, with that task: kept for good, so archiving the task does not start the step again. */
  closedSteps?: Record<string, string>;
  /** Owner-only steps with the Inbox item that asks the owner; the owner's Done answer ends the step. */
  ownerItems?: Record<string, number>;
}
const emptyState = (): State => ({ stopped: false, roadmapErrors: [], last: {}, ladder: {}, models: {}, handed: [], starts: {} });
const statePath = (name: string, env = process.env) => join(projectsDir(env), name, "state.json");

/** The state and the text it came from, so a tick writes the file only when the state changed. A missing file is empty; an unreadable one throws a line that names it. */
function loadState(name: string, env = process.env): { state: State; text: string } {
  const file = statePath(name, env);
  if (!existsSync(file)) return { state: emptyState(), text: "" };
  const text = readFileSync(file, "utf8");
  try {
    return { state: { ...emptyState(), ...JSON.parse(text) }, text };
  } catch (e) {
    throw new Error(`${file} is not readable (${e instanceof Error ? e.message : e}); fix or delete it, and this project's tick resumes`);
  }
}

/** For views: a state file that cannot be read shows as empty here; the tick stops on it instead. */
export function readState(name: string, env = process.env): State {
  try {
    return loadState(name, env).state;
  } catch {
    return emptyState();
  }
}

/**
 * Closes the open Inbox items of a task that is done, closed or gone, or that the owner wrote to since the item was
 * made, and removes the waits of a done or gone task. Returns the decisions.
 */
function closeOver(project: string, settings: Settings, world: World, dryRun: boolean, env = process.env): Decision[] {
  const tasks = world.tasks(settings.space);
  if (typeof tasks === "string") return [];
  const now = world.now();
  const out: Decision[] = [];
  const note = (task: string, reason: string) => out.push({ time: now.toISOString(), project, step: task, kind: "close", reason });
  const isDone = (task: string) => tasks.find((x) => x.id === task)?.status === "done";
  const gone = (task: string) => !tasks.some((x) => x.id === task);
  const reasonFor = (item: Item) =>
    isDone(item.task)
      ? "its task is done"
      : gone(item.task)
        ? "its task is gone"
        : world.ownerWrote(item.task, item.since)
          ? "you wrote to its task after the item was made"
          : undefined;
  for (const item of readItems(env)) {
    if (!isOpen(item) || item.task === "-") continue;
    // an item asked with no project belongs to the project whose space has its task
    if (item.project === undefined ? gone(item.task) : item.project !== project) continue;
    const reason = reasonFor(item);
    if (reason === undefined) continue;
    note(item.task, `${dryRun ? "would close" : "closed"} inbox item ${item.n}: ${reason}`);
    if (!dryRun) closeItem(item, reason, now, env);
  }
  for (const w of readWaits(env)) {
    if (w.project !== project || !isDone(w.task)) continue;
    note(w.task, `${dryRun ? "would remove" : "removed"} its wait: its task is done`);
    if (!dryRun) clearWait(w.task, env);
  }
  return out;
}

/** One tick for every project. Decisions are written once: a repeat of the last reason for a step is not. */
export function tick(world: World, dryRun: boolean, env = process.env): Decision[] {
  const all: Decision[] = [];
  world.newTick?.();
  // plans that wait from before their project let plans apply by themselves are settled under the rule
  if (!dryRun) {
    for (const start of [copyStoreQuietly]) start(env, world.now());
    all.push(
      ...logDecisions(
        [...settlePlans(world.now(), env), ...closeSettledUpdates(world.now(), env), ...sweepOldTemp(world.now(), env), ...sweepDiskUse(world.now(), env)].map(
          (reason): Decision => ({ time: world.now().toISOString(), project: "-", kind: "wake", reason }),
        ),
        env,
      ),
    );
  }
  for (const name of listProjectNames(env)) {
    const settings = readSettings(name, env);
    if (typeof settings === "string") {
      all.push({ time: world.now().toISOString(), project: name, kind: "skip", reason: settings });
      continue;
    }
    const release = dryRun ? () => {} : holdProjectTick(join(projectsDir(env), name, "tick.lock"));
    if (!release) {
      all.push({ time: world.now().toISOString(), project: name, kind: "skip", reason: "another tick is running for this project, so no step starts twice" });
      continue;
    }
    try {
      let loaded: ReturnType<typeof loadState>;
      try {
        loaded = loadState(name, env);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        if (!dryRun) askAboutState(name, reason, world.now(), env);
        all.push({ time: world.now().toISOString(), project: name, kind: "stop", reason: `stopped: ${reason}` });
        continue;
      }
      const { state } = loaded;
      const held = holdWorld(world, settings);
      const answer = (space: string, id: string, text: string) => answerCard({ space, id }, text, env);
      const ops = { clean: (t: string) => world.clean(t), close: (t: string) => world.closeTask(t) };
      const routed = routeAsks(name, settings.space, (task, text) => held.tellTask(task, text, "answer"), world.now(), dryRun, env, ops, answer).map(
        (reason): Decision => ({ time: world.now().toISOString(), project: name, kind: "wake", reason }),
      );
      const decisions = [
        ...routed,
        ...closeOver(name, settings, world, dryRun, env),
        ...serviceWaits(name, held, dryRun, env),
        ...tickProject(name, settings, held, state, dryRun, readWaits(env), loadLimit(env), env),
      ];
      if (dryRun) {
        all.push(...decisions);
        continue;
      }
      const fresh = freshDecisions(decisions, state.last);
      const text = `${JSON.stringify(state)}\n`;
      if (text !== loaded.text) writeAtomic(statePath(name, env), text);
      all.push(...logDecisions(fresh, env));
    } finally {
      release();
    }
  }
  if (!dryRun) pruneDecisions(env, world.now().getTime());
  return all;
}

/** One open Inbox item per fault, so the owner is told once however many ticks stop on it. */
function askAboutState(project: string, reason: string, now: Date, env: NodeJS.ProcessEnv): void {
  const question = `${project}: ${reason}`;
  if (readItems(env).some((i) => isOpen(i) && i.question === question)) return;
  addItem({ kind: "step", task: "-", project, question, choices: ["Ok"], since: now.toISOString() }, env);
}

function logDecisions(ds: Decision[], env: NodeJS.ProcessEnv): Decision[] {
  addDecisions(env, ds);
  return ds;
}

/** Seams for tests: the tick, its interval and where signals come from. */
export interface RunDeps {
  tick?: (world: World, dryRun: boolean) => Decision[] | Promise<Decision[]>;
  tickMs?: number;
  signals?: { once(e: string, f: (...a: any[]) => void): unknown };
}

export async function runMain(args: string[], out: (l: string) => void, world: World = realWorld(), deps: RunDeps = {}): Promise<number> {
  const bad = args.find((a) => a !== "--once" && a !== "--dry-run");
  if (bad !== undefined || (args.includes("--dry-run") && !args.includes("--once"))) {
    out(bad !== undefined ? `lineclear run: unknown option '${bad}'` : "lineclear run: --dry-run needs --once");
    return 2;
  }
  const dryRun = args.includes("--dry-run");
  const show = (ds: Decision[]) => ds.forEach((d) => out(`${d.project}  ${d.step ?? "-"}  ${d.kind}  ${d.reason}`));
  const oneTick = async () => {
    show(await (deps.tick ?? tick)(world, dryRun));
    // a tick the caller replaced is a test's: it sends nothing to a real Dispatcher
    const watched = dryRun || deps.tick ? undefined : await nightWatch(world.now());
    if (watched) out(`-  -  wake  ${watched}`);
  };
  if (args.includes("--once")) {
    await oneTick();
    return 0;
  }
  const sig = deps.signals ?? process;
  return new Promise((resolve) => {
    // a tick that is still running is not started again, and a stop waits for it
    let ticking: Promise<void> | undefined;
    const tickNow = () => {
      if (ticking) return;
      const mine = (ticking = oneTick()
        .catch((e) => {
          // a process in an unknown state does not go on acting on agents: it ends, and its supervisor starts a fresh one
          console.error(`lineclear run: tick failed, stopping: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
          clearInterval(timer);
          resolve(1);
        })
        .then(() => {
          if (ticking === mine) ticking = undefined;
        }));
    };
    const timer = setInterval(tickNow, deps.tickMs ?? TICK_MS);
    const stop = (reason: string) => {
      console.error(`lineclear run: stopping: ${reason}`);
      clearInterval(timer);
      void (ticking ?? Promise.resolve()).then(() => resolve(0));
    };
    sig.once("SIGTERM", () => stop("SIGTERM"));
    sig.once("SIGINT", () => stop("SIGINT"));
    tickNow();
  });
}

type Env = Record<string, string | undefined>;

/** True when `now` is inside a window like `22-7` (it may wrap past midnight); `off` is never night. */
export function inNight(now: Date, window: string): boolean {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(window);
  if (!m) return false;
  const [from, to, h] = [Number(m[1]), Number(m[2]), now.getHours()];
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

/** The loop's lines the Dispatcher should hear: a stall, or a skip that waits for the owner. */
const worthHearing = (d: Decision) => (d.kind === "stall" && d.event === "stall") || (d.kind === "skip" && classify(d) === "owner");

/** When tonight began, in ms: the last whole hour outside the night window, walking back from `now`. */
function nightStart(now: Date, window: string): number {
  let t = new Date(now).setMinutes(0, 0, 0);
  for (let i = 0; i < 24 && inNight(new Date(t - 3_600_000), window); i++) t -= 3_600_000;
  return t;
}

/** When the watch last sent, and when it last tried, in ms; 0 for never. */
const lastTimes = (env: Env): { sent: number; tried: number } => {
  try {
    const t = JSON.parse(readFileSync(join(dataDir(env), "night-watch.json"), "utf8"));
    return { sent: Number(t.sent) || 0, tried: Number(t.tried) || 0 };
  } catch {
    return { sent: 0, tried: 0 };
  }
};

/** Sends the Dispatcher's chat a text through Lineclear's server; the reason when it cannot. */
async function sendToDispatcher(text: string, env: Env): Promise<string | undefined> {
  const base = lineclearServer(env);
  if (!base) return "the board server is not running";
  const key = DISPATCHER.find((await readSnapshot(base)) as Parameters<typeof DISPATCHER.find>[0]);
  if (!key) return DISPATCHER.none;
  const failed = await postAction(base, { type: "send", chat: key, text, attachments: [] }, 10_000, "the board server is away", "the board server is slow");
  return failed?.error;
}

/**
 * The rule loop's night part: at night, tells the Dispatcher what the rules found (a stall, a skip that waits for the
 * owner) in running projects, since the last send or the start of the night. A quiet night sends nothing. A send that
 * fails is tried again after 15 minutes, not every tick. Returns a decision line, or undefined when nothing was due.
 */
export async function nightWatch(
  now: Date,
  env: Env = process.env,
  send: (text: string) => Promise<string | undefined> = (t) => sendToDispatcher(t, env),
): Promise<string | undefined> {
  const last = lastTimes(env);
  const at = now.getTime();
  const window = env.LINECLEAR_NIGHT_WATCH ?? "22-7";
  if (!inNight(now, window) || at - last.tried < 15 * 60_000) return undefined;
  const running = listProjectNames(env as NodeJS.ProcessEnv).filter((n) => {
    const s = readSettings(n, env as NodeJS.ProcessEnv);
    return typeof s !== "string" && !s.paused;
  });
  const since = Math.max(last.sent, nightStart(now, window));
  const found = decisionsSince<Decision>(env, since).filter((d) => Date.parse(d.time) > since && running.includes(d.project) && worthHearing(d));
  if (found.length === 0) return undefined;
  const lines = [...new Set(found.map((d) => `- ${d.project}${d.step ? ` ${d.step}` : ""}: ${d.reason}`))];
  const failed = await send(
    [
      "Night watch. The rules found this since the last message:",
      ...lines,
      "Fix what the rules allow (tell a task to go on). Ask the owner only for a login, money or something that leaves the machine.",
    ].join("\n"),
  );
  writeAtomic(join(dataDir(env), "night-watch.json"), `${JSON.stringify({ sent: failed ? last.sent : at, tried: at })}\n`);
  if (failed) return `night watch: the Dispatcher was not reached: ${failed}`;
  return `night watch: sent the Dispatcher ${found.length} finding${found.length === 1 ? "" : "s"} for ${[...new Set(found.map((d) => d.project))].join(", ")}`;
}
