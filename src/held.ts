import type { Settings } from "./project.ts";
import type { Task } from "./roadmap.ts";

// A task made by hand waits in the queue when this machine is full ("Waiting for a free slot"). It is placed on
// another machine of its project that has room: made there with the same title and brief, then closed here.

const HELD_SUB = "Waiting for a free slot";

/** The brief of a task as the owner wrote it, from `shepherdr task show --json`: Shepherdr ends every brief with its own Settings block, which the new task gets again. */
export function briefOf(showJson: string): string | undefined {
  try {
    const desc = JSON.parse(showJson)?.desc;
    return typeof desc === "string" ? desc.replace(/\n+Settings: \(from shepherdr show[\s\S]*$/, "").trim() : undefined;
  } catch {
    return undefined;
  }
}

interface Held {
  /** The parts of the rule loop's world this needs. */
  world: {
    briefOf?(id: string): string | undefined;
    addTaskOn?(host: string, settings: Settings, title: string, brief: string, extra: string[], project?: string): string | undefined;
    closeTask(id: string): string | undefined;
    /** The task's branch in the project's repo when it has one here. */
    branchOf?(repo: string, task: string): string | undefined;
    /** Pushes the branch to origin so the other machine can fetch it. Returns an error text, or undefined. */
    pushBranch?(repo: string, branch: string): string | undefined;
  };
  settings: Settings;
  project: string;
  tasks: Task[];
  /** The project's tasks on other machines: one with the same title that is not done means it is placed already. */
  remote?: Task[];
  /** The roadmap's step ids: a task of the rule loop (a step, a health fix) is left to it, as its flags are not known here. */
  stepIds: string[];
  /** Slots left on each other machine, in order; a placement takes one. */
  free: Map<string, number>;
  dryRun: boolean;
  note(reason: string, task: string): void;
}

/** The brief for the other machine: when the task has a branch here it is pushed to origin first and the brief names it. */
function withBranch(a: Held, id: string, host: string, brief: string): { brief: string; error?: string } {
  const branch = a.world.branchOf?.(a.settings.repo, id);
  if (branch === undefined) return { brief };
  const pushed = a.world.pushBranch?.(a.settings.repo, branch);
  if (pushed) return { brief, error: `held task not placed on ${host}: its branch ${branch} could not be pushed (${pushed})` };
  return { brief: `${brief}\n\nEarlier work on this task is on origin, branch ${branch}: fetch it and continue from it, do not start from main.` };
}

/** Places each held task where there is room. `placed` remembers a task made over there whose local copy would not close, so it is not made twice. */
export function placeHeld(a: Held, placed: Record<string, string>): void {
  for (const t of a.tasks) {
    if (t.status !== "queued" || t.sub !== HELD_SUB || t.id === undefined || placed[t.id]) continue;
    if (t.title.startsWith("Fix health ") || a.stepIds.some((id) => t.title.startsWith(`${id} `))) continue;
    if (a.remote?.some((r) => r.title === t.title && r.status !== "done")) {
      a.note("held task not placed: a task with its title runs on another machine already", t.id);
      continue;
    }
    const host = [...a.free].find(([, n]) => n > 0)?.[0];
    if (host === undefined) return;
    if (a.dryRun) {
      a.note(`would place the held task '${t.title}' on ${host}`, t.id);
      a.free.set(host, (a.free.get(host) ?? 0) - 1);
      continue;
    }
    const brief = a.world.briefOf?.(t.id);
    if (!brief) {
      a.note("held task not placed: its brief cannot be read", t.id);
      continue;
    }
    const moved = withBranch(a, t.id, host, brief);
    if (moved.error) {
      a.note(moved.error, t.id);
      continue;
    }
    const full = moved.brief;
    const err = a.world.addTaskOn ? a.world.addTaskOn(host, a.settings, t.title, full, [], a.project) : `this world cannot start tasks on ${host}`;
    if (err) {
      a.note(`held task not placed on ${host}: ${err}`, t.id);
      continue;
    }
    a.free.set(host, (a.free.get(host) ?? 0) - 1);
    placed[t.id] = host;
    const closed = a.world.closeTask(t.id);
    a.note(`held task started on ${host}${closed ? `, but it did not close here: ${closed}` : ", closed here"}`, t.id);
  }
}
