import { doneItems } from "./doneproof.ts";
import { addItem, isOpen, readItems } from "./inbox.ts";
import type { Step, Task } from "./roadmap.ts";
import type { Decision, State, World } from "./rules.ts";
import { DAY } from "./time.ts";

/** A step started this many times in 24 hours is not started again. */
export const START_LIMIT = 3;

/** What the limit needs of a tick. */
interface Ask {
  name: string;
  space: string;
  world: World;
  state: State;
  dryRun: boolean;
  env: NodeJS.ProcessEnv;
  note: (kind: Decision["kind"], reason: string, step?: string) => void;
}

/**
 * How many tasks were made for the step in the last 24 hours, whatever their end. Each task of the list that belongs
 * to the step is remembered by the time it was first seen, so archiving it does not take it out of the count; a start
 * whose task the list does not show yet counts through the start record.
 */
export function startsInDay(state: State, step: string, now: Date, tasks: Task[] = []): number {
  const seen = { ...state.taskSeen?.[step] };
  for (const t of tasks) {
    // a Fix task is no start of the step
    const mine = (t.title.startsWith(`${step} `) && !t.title.startsWith(`${step} Fix`)) || (t.id !== undefined && state.taskSteps?.[t.id] === step);
    if (mine) seen[t.id ?? t.title] ??= now.getTime();
  }
  // An aged entry stays while its task is listed, or the task would be taken for a new one; it goes with the task.
  const listed = new Set(tasks.map((t) => t.id ?? t.title));
  const kept = Object.fromEntries(Object.entries(seen).filter(([key, at]) => listed.has(key) || now.getTime() - at < DAY));
  state.taskSeen = { ...state.taskSeen, [step]: kept };
  const fresh = Object.values(kept).filter((at) => now.getTime() - at < DAY);
  const recorded = (state.stepStarts?.[step] ?? []).filter((at) => now.getTime() - at < DAY).length;
  return Math.max(recorded, fresh.length);
}

/** Remembers a start of the step, and forgets those older than 24 hours. */
export function recordStepStart(state: State, step: string, now: Date) {
  const recent = (state.stepStarts?.[step] ?? []).filter((at) => now.getTime() - at < DAY);
  state.stepStarts = { ...state.stepStarts, [step]: [...recent, now.getTime()] };
}

/**
 * A step that was started the limit's number of times in the last 24 hours is not started again, whatever state it is in and however
 * its tasks ended. It becomes an owner step in the Inbox once, with its done-when. Returns whether the step is over the limit.
 */
export function overStartLimit(a: Ask, step: Step, limit: number): boolean {
  const { world, state, dryRun, note, env } = a;
  const list = world.tasks(a.space);
  if (typeof list === "string") {
    note("skip", `its tasks cannot be read, so starts cannot be counted: nothing starts (${list})`, step.id);
    return true;
  }
  const started = startsInDay(state, step.id, world.now(), list);
  if (started < limit) {
    if (state.limitItems?.[step.id] !== undefined) delete state.limitItems[step.id];
    return false;
  }
  // One item per run over the limit: answering it does not make another until the step has gone under the limit.
  const told = state.limitItems?.[step.id];
  if (told !== undefined) {
    const open = readItems(env).some((i) => i.n === told && isOpen(i));
    note("skip", `started ${started} times in 24 hours with no merge: ${open ? "it waits in the Inbox" : "stopped until a start ages out"}`, step.id);
    return true;
  }
  if (dryRun) {
    note("skip", `would put ${step.id} in the Inbox: started ${started} times in 24 hours with no merge`, step.id);
    return true;
  }
  const doneWhen = doneItems(step)
    .map((i) => `- ${i}`)
    .join("\n");
  const item = addItem(
    {
      kind: "step",
      task: "-",
      project: a.name,
      question: `${step.id} ${step.title} was started ${started} times in 24 hours and no task merged. It does not start again until you decide. Its done-when:\n${doneWhen}`,
      choices: ["Ok"],
      alert: `${step.id} keeps ending without a merge`,
      since: world.now().toISOString(),
    },
    env,
  );
  state.limitItems = { ...state.limitItems, [step.id]: item.n };
  note("skip", `started ${started} times in 24 hours with no merge: stopped, Inbox item ${item.n}`, step.id);
  return true;
}
