import type { Step, Task } from "./roadmap.ts";
import { START_LIMIT, startsInDay } from "./start-limit.ts";
import type { State } from "./rules.ts";
import { clearWait, writeWait } from "./waits.ts";
import type { World } from "./world.ts";

/** Failures that come from the machine or the provider, not from the step's own work: a restart repeats them. */
type Fault = "herdr down" | "provider error" | "timeout";

const FAULTS: [Fault, RegExp][] = [
  ["herdr down", /herdr (is )?(down|crashed|not running|unreachable)/i],
  ["provider error", /provider error|rate.?limit|\b(429|50[0-4]|529)\b|overloaded/i],
  ["timeout", /\btimed? ?out\b/i],
];

/** The system fault a failure text names, or undefined when it is the step's own (a failing test). */
const faultOf = (text: string | undefined): Fault | undefined => FAULTS.find(([, re]) => re.test(text ?? ""))?.[0];

const CLEAR_TIMEOUT_MS = 10 * 60_000;

/** The step's earlier tasks (a Fix task is none), oldest first as the list holds them. */
const triesOf = (step: Step, tasks: Task[]) => tasks.filter((t) => t.title.startsWith(`${step.id} `) && !t.title.startsWith(`${step.id} Fix`));

/** Why the task failed: what it showed, then what its agent's last model call said. */
const failureOf = (world: World, t: Task) => {
  const last = t.id === undefined ? undefined : world.lastError(t.id);
  const fresh = last !== undefined && world.now().getTime() - last.at < 24 * 3600_000;
  return faultOf(t.sub) ?? (fresh ? faultOf(last.text) : undefined);
};

/** The causes of the step's last `n` tries, newest first. Undefined entries are failures of its own. */
function lastCauses(world: World, step: Step, tasks: Task[], n: number): (Fault | undefined)[] {
  return triesOf(step, tasks)
    .slice(-n)
    .reverse()
    .map((t) => failureOf(world, t));
}

/** Whether the cause is gone: herdr runs, a worker model has room, or ten minutes passed since the wait began. */
function cleared(world: World, fault: Fault, since: number, workerRoom: boolean): boolean {
  if (fault === "herdr down") {
    const h = world.herdr?.();
    return h === undefined || (h.servers.length > 0 && h.service.state === "active");
  }
  if (fault === "provider error") return workerRoom;
  return world.now().getTime() - since >= CLEAR_TIMEOUT_MS;
}

/**
 * A step whose last try failed on a system fault waits for the cause to clear instead of starting. The wait is
 * `lineclear wait`'s own file, keyed by the step. Returns the held reason, or undefined when the step may start.
 */
function heldByFault(
  a: { project: string; world: World; state: State; dryRun: boolean; env: NodeJS.ProcessEnv },
  step: Step,
  tasks: Task[],
  workerRoom: boolean,
): string | undefined {
  const { world, state, dryRun, env } = a;
  const [fault] = lastCauses(world, step, tasks, 1);
  const waits = (state.faultWaits ??= {});
  if (fault === undefined) {
    delete waits[step.id];
    return undefined;
  }
  const since = waits[step.id]?.since ?? world.now().getTime();
  if (cleared(world, fault, since, workerRoom)) {
    if (!dryRun) clearWait(step.id, env);
    // The cause is gone: this failure no longer holds the step, but it still counts as the last try's.
    waits[step.id] = { fault, since };
    return undefined;
  }
  if (dryRun) return `waits for ${fault} to clear`;
  waits[step.id] = { fault, since };
  writeWait({ task: step.id, project: a.project, kind: "fault", reason: fault, for: fault, since: new Date(since).toISOString() }, env);
  return `waits for ${fault} to clear`;
}

/** The fix task of a step started over its limit whose last two tries failed on a system fault. */
export interface FaultFix {
  title: string;
  why: string;
  brief: string;
  evidence: string[];
}

/** Names the cause of the last two failures; undefined unless both are system faults. */
function repeatedFault(world: World, step: Step, tasks: Task[], check: string): FaultFix | undefined {
  const [a, b] = lastCauses(world, step, tasks, 2);
  if (a === undefined || b === undefined) return undefined;
  const cause = a === b ? a : `${b}, then ${a}`;
  return {
    title: `${step.id} Fix: ${cause} stopped ${step.title}`.slice(0, 80),
    why: `its last two tries failed on ${cause}`,
    brief: `Step ${step.id} ${step.title} was started 3 times in 24 hours, and its last two tries failed on a system fault: ${cause}. It is not started again until this is fixed.

Find why the fault keeps coming (herdr, the provider, a limit that is too short) and fix that cause. Do not do the step's own work.

Run \`${check}\` before you merge, then rebase on main and merge it yourself.
`,
    evidence: [`${step.id}: ${cause}`],
  };
}

/** What a tick holds of a project, as far as a fault hold needs it. */
interface Hold {
  name: string;
  settings: { space: string; check: string };
  world: World;
  state: State;
  dryRun: boolean;
  env: NodeJS.ProcessEnv;
  note: (kind: "start" | "skip", reason: string, step?: string) => void;
}

/**
 * A system fault holds a step (a wait, no start); a third start after two such failures files one fix task through
 * `file`. Returns whether the step is held.
 */
export function holdForFault(t: Hold, step: Step, workerRoom: boolean, file: (fix: FaultFix) => void): boolean {
  const list = t.world.tasks(t.settings.space);
  if (typeof list === "string") return false;
  const n = startsInDay(t.state, step.id, t.world.now(), list);
  const repeat = n >= START_LIMIT ? repeatedFault(t.world, step, list, t.settings.check) : undefined;
  if (repeat) {
    if (t.dryRun) t.note("start", `would file one Fix task: ${repeat.why}`, step.id);
    else file(repeat);
    return true;
  }
  const why = heldByFault({ project: t.name, ...t }, step, list, workerRoom);
  if (why) t.note("skip", why, step.id);
  return why !== undefined;
}
