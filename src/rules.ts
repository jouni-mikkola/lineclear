import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir, decisionsPath } from "../pi/config.ts";
import { routeAsks } from "./asks.ts";
import { settlePlans } from "./plan-apply.ts";
import { copyStoreQuietly } from "./store-copies.ts";
import { freshDecisions } from "./decision-dedupe.ts";
import { answerCard, closeItem, closeSettledUpdates, isOpen, type Item, readItems } from "./inbox.ts";
import { listProjectNames, projectsDir, readSettings, type Settings } from "./project.ts";
import type { Task } from "./roadmap.ts";
import { cutDecisionsDaily, type StallEntry } from "./stall-class.ts";
import { holdProjectTick, type StartRecord } from "./starts.ts";
import { tickProject } from "./tick-project.ts";
import { sweepDiskUse } from "./disk-use.ts";
import { sweepOldTemp } from "./tmpdirs.ts";
import { holdWorld } from "./hold.ts";
import { nightWatch } from "./night-watch.ts";
import { serviceWaits } from "./wait-service.ts";
import { clearWait, loadLimit, readWaits } from "./waits.ts";
import { ownMark, realWorld, type World } from "./world.ts";
export { decisionsPath, ownMark, realWorld };
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

/** What survives a restart for one project: the last health result and the last decision per step. */
export interface State extends StartRecord {
  healthHead?: string;
  healthFailures: number;
  /** the first failing head of a run of failures, and its subject: the merge that broke main, which the revert undoes */
  firstFailed?: { head: string; subject: string };
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
const emptyState = (): State => ({ healthFailures: 0, stopped: false, roadmapErrors: [], last: {}, ladder: {}, models: {}, handed: [], starts: {} });
const statePath = (name: string, env = process.env) => join(projectsDir(env), name, "state.json");
export function readState(name: string, env = process.env): State {
  try {
    return { ...emptyState(), ...JSON.parse(readFileSync(statePath(name, env), "utf8")) };
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
      const state = readState(name, env);
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
      writeAtomic(statePath(name, env), `${JSON.stringify(state, null, 2)}\n`);
      all.push(...logDecisions(fresh, env));
    } finally {
      release();
    }
  }
  if (!dryRun) cutDecisionsDaily(decisionsPath(env), world.now());
  return all;
}

function logDecisions(ds: Decision[], env: NodeJS.ProcessEnv): Decision[] {
  if (ds.length > 0) {
    mkdirSync(configDir(env), { recursive: true });
    appendFileSync(decisionsPath(env), `${ds.map((d) => JSON.stringify(d)).join("\n")}\n`);
  }
  return ds;
}

/** One tick in a process of its own, so its commands never hold up the web server. Its decision lines go to `out`. */
async function tickAway(out: (l: string) => void): Promise<void> {
  const p = Bun.spawn([process.execPath, join(import.meta.dir, "..", "bin", "lineclear"), "run", "--once"], {
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [said, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  for (const l of said.split("\n")) if (l) out(l);
  if (code === 0 && err.trim()) console.error(err.trim());
  if (code !== 0) throw new Error(err.trim().split("\n").at(-1) || `exit ${code}`);
}

/** Seams for tests: the tick, its interval and where signals come from. */
export interface RunDeps {
  tick?: (world: World, dryRun: boolean) => Decision[] | Promise<Decision[]>;
  tickMs?: number;
  signals?: { once(e: string, f: (...a: any[]) => void): unknown; on(e: string, f: (...a: any[]) => void): unknown };
}

export async function runMain(args: string[], out: (l: string) => void, world: World = realWorld(), deps: RunDeps = {}): Promise<number> {
  const bad = args.find((a) => a !== "--once" && a !== "--dry-run");
  if (bad !== undefined || (args.includes("--dry-run") && !args.includes("--once"))) {
    out(bad !== undefined ? `lineclear run: unknown option '${bad}'` : "lineclear run: --dry-run needs --once");
    return 2;
  }
  const dryRun = args.includes("--dry-run");
  const show = (ds: Decision[]) => ds.forEach((d) => out(`${d.project}  ${d.step ?? "-"}  ${d.kind}  ${d.reason}`));
  if (args.includes("--once")) {
    show(await (deps.tick ?? tick)(world, dryRun));
    // a tick the caller replaced is a test's: it sends nothing to a real Dispatcher
    const watched = dryRun || deps.tick ? undefined : await nightWatch(world.now());
    if (watched) out(`-  -  wake  ${watched}`);
    return 0;
  }
  // a tick that is still running is not started again, and a stop waits for it
  let ticking: Promise<void> | undefined;
  const safely = () => {
    if (ticking) return;
    const tickOnce = async () => {
      try {
        if (deps.tick) show(await deps.tick(world, dryRun));
        else await tickAway(out);
      } catch (e) {
        console.error(`lineclear run: tick failed: ${e instanceof Error ? e.message : e}`);
        return;
      }
    };
    const mine = (ticking = tickOnce().then(() => {
      if (ticking === mine) ticking = undefined;
    }));
  };
  const sig = deps.signals ?? process;
  return new Promise((resolve) => {
    const timer = setInterval(safely, deps.tickMs ?? TICK_MS);
    // The loop ends on SIGTERM or SIGINT only. Anything else is told and survived.
    const stop = (reason: string) => {
      console.error(`lineclear run: stopping: ${reason}`);
      clearInterval(timer);
      void (ticking ?? Promise.resolve()).then(() => resolve(0));
    };
    const survive = (what: string) => (e: unknown) =>
      console.error(`lineclear run: ${what}, still running: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
    sig.once("SIGTERM", () => stop("SIGTERM"));
    sig.once("SIGINT", () => stop("SIGINT"));
    sig.on("SIGHUP", () => console.error("lineclear run: SIGHUP ignored, still running"));
    sig.on("uncaughtException", survive("uncaught error"));
    sig.on("unhandledRejection", survive("unhandled rejection"));
    sig.on("beforeExit", () => console.error("lineclear run: the event loop ran empty; this is a bug"));
    safely();
  });
}
