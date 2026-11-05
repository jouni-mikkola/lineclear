import { IDLE_TEXT, lineOf } from "./cards.ts";
import { type HomeProject, projectsData } from "./home-data.ts";
import { isOpen, type Item, readItems } from "./inbox.ts";
import { type Export, remoteExports } from "./remotes.ts";
import { readWaits, waitsForOwner } from "./waits.ts";

/** An Inbox item, with the machine that holds it when that is not this one, and its task's title when Home knows it. */
export type MachineItem = Item & { machine?: string; title?: string; result?: string };

/** A task that waits for you with no open Inbox item: it is answered in its chat. */
export interface WaitingTask {
  task: string;
  project: string;
  machine?: string;
  /** The text of its last card, else why Shepherdr says it waits. */
  text: string;
  title?: string;
  /** What the task gives once it lands, in one sentence (its step's result). */
  result?: string;
  /** Since when it waits (ISO time): its last change. */
  since?: string;
}

/**
 * What waits for you, as one list: the open Inbox items (newest first), then each task that waits for you with no open
 * item, each task once. Home's headline, the Inbox badge and `lineclear status` count it.
 */
export function waitingForYou(
  env = process.env,
  remote: Export[] = remoteExports(env),
  projects: HomeProject[] = projectsData(env, Date.now(), remote),
): { items: MachineItem[]; tasks: WaitingTask[] } {
  const titles = new Map(projects.flatMap((p) => p.tasks.map((t) => [t.id, t.title] as const)));
  const results = new Map(projects.flatMap((p) => p.tasks.flatMap((t) => (t.result ? [[t.id, t.result] as const] : []))));
  const titled = (i: MachineItem): MachineItem => ({
    ...i,
    ...(titles.has(i.task) ? { title: titles.get(i.task) } : {}),
    ...(results.has(i.task) ? { result: results.get(i.task) } : {}),
  });
  const items: MachineItem[] = [
    ...readItems(env).filter(isOpen).reverse(),
    ...remote.flatMap((e) =>
      e.inbox
        .filter(isOpen)
        .reverse()
        .map((i) => ({ ...i, machine: e.host })),
    ),
  ].map(titled);
  const asked = new Set(items.map((i) => i.task));
  const tasks = new Map<string, WaitingTask>();
  // what an agent declared it waits for the owner for: its reason is the card's line
  const waits = readWaits(env);
  const declared = new Map(waits.filter(waitsForOwner).map((w) => [w.task, w.reason] as const));
  // a task that waits for another task, a check slot or a set time, or whose start failed, asks the owner nothing
  const machineWaits = new Set(waits.filter((w) => !declared.has(w.task)).map((w) => w.task));
  for (const p of projects) {
    for (const t of p.tasks) {
      if (t.state !== "need" || asked.has(t.id) || tasks.has(t.id) || machineWaits.has(t.id)) continue;
      const line = declared.get(t.id) ?? (t.text === undefined ? "Waits for you" : lineOf(t.text));
      // an agent that only ended its turn asked nothing and declared no wait: not the owner's to answer
      if (line === IDLE_TEXT) continue;
      tasks.set(t.id, {
        task: t.id,
        project: p.name,
        ...(p.machine ? { machine: p.machine } : {}),
        text: line,
        title: t.title,
        ...(t.result ? { result: t.result } : {}),
        ...(Number.isFinite(t.at) && t.at > 0 ? { since: new Date(t.at).toISOString() } : {}),
      });
    }
  }
  return { items, tasks: [...tasks.values()] };
}

export const countWaiting = (w: { items: MachineItem[]; tasks: WaitingTask[] }) => w.items.length + w.tasks.length;
