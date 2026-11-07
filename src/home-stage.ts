import { questionIn } from "./cards.ts";
import type { Stage, TaskState } from "./home-data.ts";

/** A parsed file or event read as it is: its shape is not ours to promise. */
type Raw = any;

/** The fields of a task record that Home reads. The server writes `stage`, `stageAt`, `step` and `laneReleased` where the event happens. */
export interface TaskRecord {
  id: string;
  title?: string;
  created?: number;
  updated?: number;
  doneAt?: number;
  merged?: boolean;
  closed?: boolean;
  told?: string;
  reported?: boolean;
  stage?: string;
  stageAt?: number;
  step?: string;
  laneReleased?: string;
  mergeStopped?: string;
  landing?: { step?: string; at?: number };
  worktree?: string;
  base?: string;
  machine?: string;
  agent?: { model?: string };
  reviewer?: { model?: string };
  report?: { msg?: string; progress?: number };
  stalled?: { life?: number };
}

/**
 * The state of one Lineclear task: from `lineclear task list` (`listed` is its status there) where it can say, else from
 * what the task was last told. A chat card never decides it.
 */
export function taskState(task: Partial<TaskRecord>, listed: string | undefined): TaskState | undefined {
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
export function taskStage(task: Partial<TaskRecord>, state: TaskState, line?: string): Stage {
  if (state === "done") return "done";
  if (state === "queued") return "queued";
  if (task.reported === true) return "ready";
  // the record's own stage wins; the status line is read only for a task whose record has none (a task of another machine)
  if (task.stage === "work" || task.stage === "review") return task.stage;
  if (/\breview/i.test(line ?? task.report?.msg ?? "")) return "review";
  return "work";
}

// a task of another machine has no record here: the first read that saw it at its stage, as long as this process runs
const seen = new Map<string, { stage: Stage; since: number }>();

/** Since when a task is at its stage: the record's `stageAt`, else its creation or merge, else its last update. */
export function stageSince(task: Partial<TaskRecord> & { id: string }, stage: Stage, now: number): number {
  if (typeof task.stageAt === "number" && task.stage === stage) return task.stageAt;
  if (stage === "queued" && task.created !== undefined) return task.created;
  if (stage === "done" && (task.doneAt ?? task.updated) !== undefined) return (task.doneAt ?? task.updated) as number;
  const recorded = task.updated ?? task.created;
  if (recorded !== undefined) return recorded;
  const was = seen.get(task.id);
  const since = was?.stage === stage ? was.since : now;
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
      const asked = IDLE_CARD.test(p.card.text) ? questionIn(String(p.card.ask?.reply?.text ?? "")) : undefined;
      if ((last.get(task)?.at ?? -1) <= p.at) last.set(task, { at: p.at, text: asked ?? p.card.text });
    }
  }
  return last;
}

export const IDLE_CARD = /^(?:needs you:\s*)?Waits for your reply$/i;
