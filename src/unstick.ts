import type { Settings } from "./project.ts";
import type { Task } from "./roadmap.ts";
import type { Decision, State, World } from "./rules.ts";
import type { Wait } from "./waits.ts";

// Two ways a task is left lying on the board with nobody behind it: a task of the rules whose start went wrong is
// closed so the roadmap starts its step again, and a task that sits on Ready to merge long after its agent reported is
// told once in a while to go on (its merge may be its own to run).

/** A task shows Ready to merge this long before its agent is told, and again at most this often. */
const READY_AFTER_MS = 15 * 60_000;
const WAKE_GAP_MS = 45 * 60_000;

/** A started wrong task is closed only after it has shown Went wrong this long: a hand-over may still try again. */
const WRONG_AFTER_MS = 3 * 60_000;

// The tell ends with `lineclear ready`, because any message to a task takes it off Ready to merge.
const READY_TELL =
  "Your task is ready but not merged. If your brief says to merge it yourself, run `lineclear merge <id>` until it is through (on a conflict, rebase on the base keeping both sides). Otherwise run `lineclear ready <id>` again with the same summary and facts, and nothing more.";

interface Args {
  project: string;
  settings: Settings;
  world: World;
  state: State;
  waits: Wait[];
  dryRun: boolean;
}

const WENT_WRONG = /^Went wrong/;

/** No work to lose: a clean worktree, or (a start that failed before its worktree existed) a branch with no commit beyond main. */
function holdsNothing(a: Args, id: string): boolean {
  if (a.world.clean(id)) return true;
  const branch = a.world.branchOf(a.settings.repo, id);
  return branch !== undefined && a.world.commitsAhead(a.settings.repo, branch) === 0;
}

/** A task the rules started that shows Went wrong and holds no work is closed, so its step starts again. */
function closeFailedStarts(a: Args, tasks: Task[], out: Decision[]): void {
  const { world, state, dryRun } = a;
  const decide = (reason: string, id: string) => out.push({ time: world.now().toISOString(), project: a.project, step: id, kind: "close", reason });
  const now = world.now().getTime();
  const since = (state.wrongSeen ??= {});
  const waiting = new Set(a.waits.map((w) => w.task));
  for (const id of Object.keys(since)) if (!tasks.some((t) => t.id === id && WENT_WRONG.test(t.sub ?? ""))) delete since[id];
  for (const t of tasks) {
    if (t.id === undefined || t.status !== "need" || !WENT_WRONG.test(t.sub ?? "") || state.taskSteps?.[t.id] === undefined) continue;
    since[t.id] ??= now;
    if (now - since[t.id]! < WRONG_AFTER_MS || waiting.has(t.id) || !holdsNothing(a, t.id)) continue;
    const err = dryRun ? undefined : world.closeTask(t.id);
    decide(
      err
        ? `could not close ${t.id}, whose start went wrong: ${err}`
        : `${dryRun ? "would close" : "closed"} ${t.id}: its start went wrong, its step starts again`,
      t.id,
    );
  }
}

/** A task that stays on Ready to merge is told to go on, once per 45 minutes, unless it declared a wait or the owner wrote to it. */
function wakeReady(a: Args, tasks: Task[], out: Decision[]): void {
  const { world, state, dryRun } = a;
  const now = world.now().getTime();
  const seen = (state.readySeen ??= {});
  const waiting = new Set(a.waits.map((w) => w.task));
  for (const t of tasks) {
    if (t.id === undefined || t.status !== "ready") continue;
    const entry = (seen[t.id] ??= { since: now });
    if (now - entry.since < READY_AFTER_MS || now - (entry.woke ?? 0) < WAKE_GAP_MS || waiting.has(t.id)) continue;
    if (world.ownerWrote(t.id, new Date(entry.since).toISOString())) continue;
    const err = dryRun ? undefined : world.tellTask(t.id, READY_TELL.replace("<id>", t.id), "resume");
    if (!dryRun) entry.woke = now;
    out.push({
      time: world.now().toISOString(),
      project: a.project,
      step: t.id,
      kind: "wake",
      reason: err
        ? `telling ${t.id} to go on failed: ${err}`
        : `${dryRun ? "would tell" : "told"} ${t.id} to go on: it has shown Ready to merge for ${Math.round((now - entry.since) / 60_000)} minutes`,
    });
  }
  // a task that works after a tell keeps its record, so the 45 minutes hold; only a gone one loses it
  for (const [id, entry] of Object.entries(seen)) {
    const task = tasks.find((t) => t.id === id);
    if (!task) delete seen[id];
    else if (task.status !== "ready") entry.since = now;
  }
}

/** One tick for one project: the decisions it made. */
export function unstick(a: Args): Decision[] {
  const tasks = a.world.tasks(a.settings.space);
  if (typeof tasks === "string") return [];
  const out: Decision[] = [];
  closeFailedStarts(a, tasks, out);
  wakeReady(a, tasks, out);
  return out;
}
