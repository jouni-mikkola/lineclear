// The waits a task asked for with a time or another task: stopped while they hold, woken when they are over.
import type { Decision, World } from "./rules.ts";
import { readSettings } from "./project.ts";
import type { Task } from "./roadmap.ts";
import { clearWait, readWaits, writeWait } from "./waits.ts";

type Note = (kind: Decision["kind"], reason: string) => void;

/** One move on a wait: on a dry run only what it would do, else the move, then the wait kept up to date and what was done. */
function move(
  dryRun: boolean,
  note: Note,
  kind: "wake" | "stop",
  m: { task: string; would: string; act: () => string | undefined; keep: () => void; did: string },
): void {
  const err = dryRun ? undefined : m.act();
  if (dryRun) note(kind, `would ${m.would}`);
  else if (err) note("skip", `could not ${kind} ${m.task}: ${err}`);
  else {
    m.keep();
    note(kind, m.did);
  }
}

/** Stops the task of each `until` wait and wakes it when its time comes; wakes the task of a `task` wait once the other is done. Returns the decisions. */
export function serviceWaits(project: string, world: World, dryRun: boolean, env = process.env): Decision[] {
  const out: Decision[] = [];
  const now = world.now();
  let tasks: Task[] | string | undefined;
  const doneTask = (id: string) => {
    const settings = readSettings(project, env);
    if (typeof settings === "string") return false;
    tasks ??= world.tasks(settings.space);
    return typeof tasks !== "string" && tasks.some((t) => t.id === id && t.status === "done");
  };
  for (const w of readWaits(env)) {
    if (w.project !== project) continue;
    const note: Note = (kind, reason) => out.push({ time: now.toISOString(), project, step: w.task, kind, reason });
    const wake = (why: string, text: string, did: string) =>
      move(dryRun, note, "wake", {
        task: w.task,
        would: `wake ${w.task}: ${why}`,
        act: () => world.tellTask(w.task, text, "resume"),
        keep: () => clearWait(w.task, env),
        did,
      });
    if (w.kind === "task" && w.for !== undefined) {
      if (doneTask(w.for))
        wake(`task ${w.for} is done`, `Task ${w.for} is done (${w.reason}). Carry on with your task.`, `woke ${w.task}, task ${w.for} is done: ${w.reason}`);
    } else if (w.kind === "until" && w.until !== undefined) {
      if (new Date(w.until) <= now)
        wake(
          w.reason,
          `Your wait until ${w.until} is over (${w.reason}). Carry on with your task.`,
          `woke ${w.task}, its wait until ${w.until} is over: ${w.reason}`,
        );
      else if (!w.stopped)
        move(dryRun, note, "stop", {
          task: w.task,
          would: `stop ${w.task} until ${w.until}: ${w.reason}`,
          act: () => world.stopTask(w.task),
          keep: () => writeWait({ ...w, stopped: true }, env),
          did: `stopped ${w.task} until ${w.until}: ${w.reason}`,
        });
    }
  }
  return out;
}
