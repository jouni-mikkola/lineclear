// An agent's limits live in code, not in a prompt: a task past its wall time is stopped with a report, and an agent silent
// for 20 minutes is stopped instead of reminded (src/stalls.ts calls both).
import type { State } from "./rules.ts";
import type { Task } from "./roadmap.ts";

/** Wall time a task may run, in minutes, when the project's settings name none. */
export const DEFAULT_TASK_LIMIT_MIN = 120;
const WORK_KEY = "(at work)";

/** The tasks at work whose first sighting is older than the limit. A task never seen is not over. */
export function overTime(state: State, tasks: Task[], now: Date, limitMin = DEFAULT_TASK_LIMIT_MIN): { id: string; minutes: number }[] {
  const seen = new Map(Object.entries(state.taskSeen?.[WORK_KEY] ?? {}));
  return tasks.flatMap((t) => {
    const at = t.id === undefined ? undefined : seen.get(t.id);
    if (t.id === undefined || at === undefined || t.status !== "work") return [];
    const minutes = Math.round((now.getTime() - at) / 60_000);
    return minutes >= limitMin ? [{ id: t.id, minutes }] : [];
  });
}

/** Remembers when each task at work was first seen (steps and loose tasks alike); a task waiting or gone starts its time over. */
export function noteWorkSeen(state: State, tasks: Task[], now: Date, asleep: Set<string> = new Set()): void {
  const work = tasks.flatMap((t) => (t.status === "work" && t.id !== undefined && !asleep.has(t.id) ? [t.id] : []));
  const before = state.taskSeen?.[WORK_KEY] ?? {};
  state.taskSeen = { ...state.taskSeen, [WORK_KEY]: Object.fromEntries(work.map((id) => [id, before[id] ?? now.getTime()])) };
}
