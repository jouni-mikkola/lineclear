// Rung 1 of the stall ladder and the wall-time limit both end a task the same way: stop the agent (a closed task counts as done and would lose its wait), tell the Inbox.
import { DEFAULT_TASK_LIMIT_MIN, noteWorkSeen, overTime } from "./agent-limits.ts";
import { addItem } from "./inbox.ts";
import { writeWait } from "./waits.ts";
import type { Settings } from "./project.ts";
import type { Task } from "./roadmap.ts";
import type { Decision, State, World } from "./rules.ts";

interface Ctx {
  project: string;
  world: World;
  dryRun: boolean;
  settings: Settings;
  state: State;
  tasks: Task[];
  env: NodeJS.ProcessEnv;
  note: (kind: Decision["kind"], reason: string, step?: string) => void;
}

/** Closes a task that went silent or ran past its wall time, and says so in the Inbox. */
export function closeWithReport(a: Ctx, now: Date, ladder: { rung: number }, gone: Set<string>, t: Task, why: string): boolean {
  const id = t.id!;
  if (a.dryRun) {
    a.note("stall", `rung 1: would stop ${id} with a report (${why})`, id);
    return true;
  }
  const err = a.world.stopTask(id);
  if (err) {
    a.note("skip", `could not stop ${id}: ${err}`, id);
    return false;
  }
  const item = addItem(
    {
      kind: "stuck",
      task: id,
      project: a.project,
      question: `${id} was stopped: ${why}. Its branch keeps its commits. What now?`,
      choices: ["Keep waiting", "I will look"],
      since: now.toISOString(),
    },
    a.env,
  );
  // a wait for the owner keeps the step from starting over by itself
  writeWait({ task: id, project: a.project, kind: "owner", reason: `asked: ${item.question}`, since: now.toISOString() }, a.env);
  ladder.rung = Math.max(ladder.rung, 1);
  gone.add(id);
  a.note("stall", `rung 1: stopped ${id} with a report, Inbox item ${item.n} (${why})`, id);
  return true;
}

/** A task at work past the project's wall-time limit is stopped with a report. */
export function limitWallTime(a: Ctx, now: Date, ladderOf: (id: string) => { rung: number }, gone: Set<string>, waiting: Set<string>): void {
  noteWorkSeen(a.state, a.tasks, now, new Set([...waiting, ...gone]));
  const limit = a.settings.taskLimitMin ?? DEFAULT_TASK_LIMIT_MIN;
  for (const { id, minutes } of overTime(a.state, a.tasks, now, limit)) {
    if (gone.has(id) || waiting.has(id)) continue;
    const t = a.tasks.find((x) => x.id === id);
    if (t) closeWithReport(a, now, ladderOf(id), gone, t, `it ran ${minutes} min, past its wall-time limit of ${limit} min`);
  }
}
