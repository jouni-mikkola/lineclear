// The stall ladder's part of each tick: the detectors after a project's tick, the remedies of the classes the
// ladder has no rung for, and after all projects the fixes Lineclear files for itself and the daily summary.
import { appendFileSync } from "node:fs";
import type { Settings } from "./project.ts";
import type { Task } from "./roadmap.ts";
import type { Decision, State, World } from "./rules.ts";
import { IDLE_TEXT } from "./cards.ts";
import { fileOutsideFixes } from "./outside-fix.ts";
import { fileFixes } from "./self-fix.ts";
import { decisionsPath } from "../pi/config.ts";
import { CLASS_INFO, type Observation, type StallClass, cutDecisionsDaily, taskObservations, watchStalls } from "./stall-class.ts";
import { readWaits } from "./waits.ts";
import { watchWaste } from "./waste-watch.ts";

/** What a project's tick learned that its stall detectors read. */
export interface TickFacts {
  tasks?: Task[];
  done?: Set<string>;
  stepOf?: (t: Task) => string | undefined;
}

/** Where a project's state keeps when the loop last ticked it. */
const TICK_KEY = "~tick";

const LOCK_REMINDER =
  "Another step waits for a lock your step holds, and it has waited for hours. Finish and merge, or say with `lineclear status` what holds you up.";
const LOCK_RESUME =
  "Another step waits for a lock your step holds, and nothing waits for the owner. Read your brief and your branch, then carry on, or say with `lineclear status` what holds you up.";
const MERGE_AGAIN =
  "Your merge has been queued for two hours: its result was dropped. Bring your branch up to date with main, then run lineclear merge again until it says merged or what stopped it.";
const CARRY_ON = "Your agent was found waiting after its restart failed. Nothing waits for the owner: read your brief and your branch, then carry on.";

/** The stalls whose remedy is a word to the task's own agent: what it is told, and what the decision says. */
const TOLD: Partial<Record<StallClass, { text: string; did: string }>> = {
  "revive-loop": { text: CARRY_ON, did: "to carry on instead of reviving it again" },
  "merge-lost": { text: MERGE_AGAIN, did: "to merge again: its merge result was dropped" },
};

/**
 * The stall detectors after a project's tick: each stop gets its class, a stall past its limit is recorded, and the
 * classes the ladder has no rung for get their remedy here. Returns the new decisions.
 */
export function stallsOf(
  name: string,
  settings: Settings,
  world: World,
  state: State,
  decisions: Decision[],
  facts: TickFacts,
  dryRun: boolean,
  env = process.env,
): Decision[] {
  const now = world.now();
  const tasks = facts.tasks ?? [];
  const declared = new Set(
    readWaits(env)
      .filter((w) => w.project === name || w.project === undefined)
      .map((w) => w.task),
  );
  const observed: Observation[] =
    facts.done && facts.stepOf
      ? taskObservations(
          tasks,
          facts.stepOf,
          facts.done,
          world.stallCards(settings.space, settings.repo),
          world.chatCards(settings.space, settings.repo),
          now.getTime(),
          declared,
          unanswered(state.starts),
          state.stalls,
        )
      : [];
  // The project's coordinator is the rule loop: a tick after a long silence says it was gone, and since when.
  const lastTick = Date.parse(state.last[TICK_KEY] ?? "");
  const gap = Number.isNaN(lastTick) ? 0 : now.getTime() - lastTick;
  if (gap >= CLASS_INFO["coordinator-gone"].limit * 60_000)
    observed.push({
      key: "-",
      class: "coordinator-gone",
      evidence: `the loop did not tick ${name} for ${Math.round(gap / 60_000)} min`,
      since: lastTick,
    });
  if (!dryRun) state.last[TICK_KEY] = now.toISOString();
  const remedy = (o: Observation): string | undefined => {
    if (dryRun) return undefined;
    if (o.class === "idle-after-done") return closeIdle(world, settings.repo, o.key);
    if (o.class === "coordinator-gone") return `the loop ticks ${name} again`;
    const told = TOLD[o.class];
    if (told) return world.tellTask(o.key, told.text, "resume") ? undefined : `told ${o.key} ${told.did}`;
    if (o.class === "lock-held") return lockRemedy(o, tasks, state.taskSteps ?? {}, facts.done, declared, world, settings.repo);
    return undefined;
  };
  return watchStalls(name, state, decisions, observed, now, remedy);
}

/**
 * The remedy of a held lock, by what its holder (the open task the rules started for the step, from their record) is doing: a merged
 * step's task is closed, a task at work is reminded, one in any other state is told to
 * resume, and one that waits for the owner is left alone and the line says so.
 */
function lockRemedy(
  o: Observation,
  tasks: Task[],
  taskSteps: Record<string, string>,
  done: Set<string> | undefined,
  declared: Set<string>,
  world: World,
  repo: string,
): string | undefined {
  const m = /lock '(.*)' is held by (\S+)/.exec(o.evidence);
  const holder = m && tasks.find((t) => t.id !== undefined && t.status !== "done" && t.status !== "closed" && taskSteps[t.id] === m[2]);
  if (!m || !holder?.id) return undefined;
  const held = `holds lock '${m[1]}'`;
  if (done?.has(m[2] as string)) return closeIdle(world, repo, holder.id);
  const silent = holder.status === "need" && holder.sub === IDLE_TEXT && !declared.has(holder.id);
  if (holder.status === "need" && !silent) return `${holder.id}, which ${held}, waits for the owner`;
  if (declared.has(holder.id)) return `${holder.id}, which ${held}, waits for the owner`;
  const working = holder.status === "work";
  const err = world.tellTask(holder.id, working ? LOCK_REMINDER : LOCK_RESUME, "resume");
  return err ? undefined : `${working ? "reminded" : "told"} ${holder.id}, which ${held}${working ? "" : ", to resume"}`;
}

/** Closes a task whose step is merged, unless its branch holds commits main lacks: that stall stays recorded for the owner. */
function closeIdle(world: World, repo: string, id: string): string | undefined {
  const branch = world.branchOf(repo, id);
  if (branch !== undefined && world.commitsAhead(repo, branch) > 0) return undefined;
  return world.closeTask(id) ? undefined : `closed ${id}: its step is merged`;
}

/** Starts the start ladder found silent (it climbed a rung): their agent never answered the brief, since first seen. */
function unanswered(starts: State["starts"] = {}): Record<string, { since: number }> {
  return Object.fromEntries(Object.entries(starts).flatMap(([id, s]) => (!s.acted && s.rung > 0 ? [[id, { since: s.since }]] : [])));
}

/** After every project's tick: the fixes to file, then once a day the archive. The new decisions. */
export function afterTick(world: World, all: Decision[], env = process.env): Decision[] {
  const filed = [...fileFixes(world, decisionsPath(env), all, env), ...watchWaste(world, env)];
  fileOutsideFixes(world, env);
  if (filed.length > 0) appendFileSync(decisionsPath(env), `${filed.map((d) => JSON.stringify(d)).join("\n")}\n`);
  cutDecisionsDaily(decisionsPath(env), world.now());
  return filed;
}
