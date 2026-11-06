import { keepsMerge } from "./asks.ts";
import type { Settings } from "./project.ts";
import type { Task } from "./roadmap.ts";
import type { Decision, State, World } from "./rules.ts";
import type { Wait } from "./waits.ts";

// Two ways a task is left lying on the board with nobody behind it: a task of the rules whose start went wrong is
// closed so the roadmap starts its step again, and a task that sits on Ready to merge with no merge running is merged
// by the rules (rebase, check, merge).

/** A task shows Ready to merge this long before its merge is started, and again at most this often. */
const READY_AFTER_MS = 10 * 60_000;
const MERGE_GAP_MS = 10 * 60_000;
/** After this many merges that left the task on Ready the rules leave it alone; the card shows why the last one stopped. */
const MAX_TRIES = 2;

/** A started wrong task is closed only after it has shown Went wrong this long: a hand-over may still try again. */
const WRONG_AFTER_MS = 3 * 60_000;

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

/** The first task on Ready to merge for 10 minutes has its merge started (one per tick), unless it declared a wait, its merge is the owner's, or the owner wrote to it. */
function mergeReady(a: Args, tasks: Task[], out: Decision[]): void {
  const { world, state, dryRun } = a;
  const now = world.now().getTime();
  const seen = (state.readySeen ??= {});
  const waiting = new Set(a.waits.map((w) => w.task));
  let started = false;
  for (const t of tasks) {
    if (t.id === undefined || t.status !== "ready") continue;
    const entry = (seen[t.id] ??= { since: now });
    const idle = now - entry.since >= READY_AFTER_MS && now - (entry.tried ?? 0) >= MERGE_GAP_MS;
    if (started || !idle || (entry.tries ?? 0) >= MAX_TRIES || waiting.has(t.id) || keepsMerge(t.desc)) continue;
    if (world.ownerWrote(t.id, new Date(entry.since).toISOString())) continue;
    started = true;
    const err = dryRun ? undefined : world.mergeTask(t.id);
    if (!dryRun) {
      entry.tried = now;
      entry.tries = (entry.tries ?? 0) + 1;
    }
    out.push({
      time: world.now().toISOString(),
      project: a.project,
      step: t.id,
      kind: "run",
      reason: err
        ? `starting the merge of ${t.id} failed: ${err}`
        : `${dryRun ? "would merge" : "started the merge of"} ${t.id}: it has shown Ready to merge for ${Math.round((now - entry.since) / 60_000)} minutes`,
    });
  }
  // a task that works again starts over; only a gone one loses its record
  for (const [id, entry] of Object.entries(seen)) {
    const task = tasks.find((t) => t.id === id);
    if (!task) delete seen[id];
    else if (task.status !== "ready") Object.assign(entry, { since: now, tries: 0 });
  }
}

/** One tick for one project: the decisions it made. */
export function unstick(a: Args): Decision[] {
  const tasks = a.world.tasks(a.settings.space);
  if (typeof tasks === "string") return [];
  const out: Decision[] = [];
  closeFailedStarts(a, tasks, out);
  mergeReady(a, tasks, out);
  return out;
}
