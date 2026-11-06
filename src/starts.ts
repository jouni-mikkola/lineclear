import { existsSync, readdirSync, readFileSync } from "node:fs";
import { herdrArgv } from "./herdr.ts";
import { join } from "node:path";
import { fileClash, stepHeld, stepNeeds } from "./parts.ts";
import { fitTitle, type Step, stepOfTask, type Task } from "./roadmap.ts";
import type { State } from "./rules.ts";

type Run = (cmd: string[]) => { code: number; out: string; err?: string };

/** The herdr name of a task's agent: `shep-` and the lowercase task id. */
export const agentName = (id: string) => `shep-${id.toLowerCase()}`;

/**
 * How far a task's start got. `acted`: its agent's session holds an answer, so the brief arrived. `busy`: herdr sees it working on its first turn. `silent`: it is there but never answered. `gone`: herdr
 * knows no such agent, the start that left tasks "Working" for hours with no agent behind them.
 */
export type StartState = { kind: "acted" | "busy" | "silent" | "gone" };

/** A pi pane that shows a pasted block, not yet sent. */
const PASTED = /\[paste #\d+|\[pasted /i;

const ANSWER = '"role":"assistant"';

/** Some session in a pi session folder holds an answer. */
function folderAnswered(folder: string | undefined): boolean {
  if (folder === undefined || !existsSync(folder)) return false;
  return readdirSync(folder).some((f) => f.endsWith(".jsonl") && readFileSync(join(folder, f), "utf8").includes(ANSWER));
}

/** `sessionsOf` finds the pi session folder of the task's worktree: an agent herdr lost after it answered is no failed start. */
export function agentStart(id: string, run: Run, worktree?: string, sessionsOf?: (worktree: string) => string): StartState {
  const r = run(herdrArgv(["agent", "get", agentName(id)]));
  const sessions = worktree === undefined ? undefined : sessionsOf?.(worktree);
  if (r.code !== 0) return folderAnswered(sessions) ? { kind: "acted" } : { kind: "gone" };
  try {
    const agent = JSON.parse(r.out).result?.agent;
    const file = agent?.agent_session?.value;
    const text = typeof file === "string" && existsSync(file) ? readFileSync(file, "utf8") : "";
    if (text.includes(ANSWER)) return { kind: "acted" };
    if (agent?.agent_status !== "working") return { kind: "silent" };
    const pane = run(herdrArgv(["agent", "read", agentName(id)]));
    return pane.code === 0 && PASTED.test(pane.out) ? { kind: "silent" } : { kind: "busy" };
  } catch {
    return { kind: "silent" };
  }
}

/**
 * Types `text` and Enter into (only Enter when the pane still shows the pasted brief) the pane that runs in the task's worktree. A pane works when herdr no longer knows the
 * agent by name, so this reaches a start the named agent commands cannot. Returns an error text, or undefined.
 */
export function nudgePane(id: string, text: string, run: Run, dir: string | undefined): string | undefined {
  const list = run(herdrArgv(["pane", "list"]));
  let pane: string | undefined;
  try {
    const panes: { pane_id?: string; cwd?: string; foreground_cwd?: string }[] = JSON.parse(list.out).result?.panes ?? [];
    pane = dir === undefined ? undefined : panes.find((p) => p.cwd === dir || p.foreground_cwd === dir)?.pane_id;
  } catch {
    pane = undefined;
  }
  // A pane that still holds the pasted brief needs its Enter, never more text on top of it.
  if (pane !== undefined && PASTED.test(run(herdrArgv(["pane", "read", pane, "--source", "visible", "--format", "text"])).out)) {
    const entered = run(herdrArgv(["pane", "send-keys", pane, "Enter"]));
    return entered.code === 0 ? undefined : (entered.err || entered.out).trim() || `exit ${entered.code}`;
  }
  const said = pane === undefined ? run(herdrArgv(["agent", "prompt", agentName(id), text])) : run(herdrArgv(["pane", "send-text", pane, text]));
  const sent = said.code === 0 && pane !== undefined ? run(herdrArgv(["pane", "send-keys", pane, "Enter"])) : said;
  return sent.code === 0 ? undefined : (sent.err || sent.out).trim() || `exit ${sent.code}`;
}

/** What the rules keep of the tasks they start: the step of each task by id, and the titles no task has taken yet. */
export interface StartRecord {
  taskSteps?: Record<string, string>;
  pendingStarts?: Record<string, string>;
}

/** The rules asked for a task titled `title` for `step`. */
export function recordStart(state: StartRecord, title: string, step: string) {
  state.pendingStarts = { ...state.pendingStarts, [fitTitle(title)]: step };
}

/** Records the step of each task the rules started: a task with a title they asked for, once, by its exact title. */
export function bindStarts(state: StartRecord, tasks: Task[]) {
  state.pendingStarts ??= {};
  state.taskSteps ??= {};
  const { pendingStarts: pending, taskSteps } = state;
  for (const t of tasks) {
    const step = pending[t.title];
    if (t.id === undefined || step === undefined || taskSteps[t.id] !== undefined || t.status === "done") continue;
    taskSteps[t.id] = step;
    delete pending[t.title];
  }
}

/** The steps with a task that still runs for them (an orphaned task holds no locks). */
export function liveSteps(steps: Step[], tasks: Task[], remote: Task[], taskSteps: Record<string, string> | undefined): Set<string> {
  const live = new Set<string>();
  for (const t of tasks) {
    const id = t.status === "done" || t.orphaned ? undefined : stepOfTask(steps, t, remote.includes(t) ? undefined : taskSteps)?.id;
    if (id !== undefined) live.add(id);
  }
  return live;
}

/** A ready step skipped for locks this many ticks in a row reserves what it needs. */
export const AGE_TICKS = 10;

/** The locks the aged ready steps reserve, oldest first, each by the step that reserved it; a step blocked by an older reservation reserves nothing. */
export function reservedLocks(status: { id: string; state: string }[], byId: Map<string, Step>, waits: Record<string, number> = {}): Map<string, string> {
  const reserved = new Map<string, string>();
  const ids = status.filter((st) => st.state === "ready" || st.state === "unproven").map((st) => st.id);
  const aged = ids
    .filter((id) => (waits[id] ?? 0) >= AGE_TICKS)
    .sort((a, b) => (waits[b] ?? 0) - (waits[a] ?? 0))
    .map((id) => byId.get(id) as Step);
  for (const s of aged) if (lockWhy(s, new Map(), reserved) === undefined) for (const l of stepHeld(s)) reserved.set(l, s.id);
  return reserved;
}

/** Why a lock keeps the step from starting: another step holds a lock or file it needs, or an aged step reserved it. */
export function lockWhy(step: Step, held: Map<string, string>, reserved: Map<string, string>): string | undefined {
  const clash = stepNeeds(step).find((l) => held.has(l)) ?? fileClash(step, held.keys());
  if (clash) return `lock '${clash.replace(/^[=~]/, "")}' is held by ${held.get(clash)}`;
  const others = [...reserved].filter(([, owner]) => owner !== step.id).map(([lock]) => lock);
  const lock = stepNeeds(step).find((l) => others.includes(l)) ?? fileClash(step, others);
  return lock === undefined ? undefined : `lock '${lock.replace(/^[=~]/, "")}' is reserved for ${reserved.get(lock)}, skipped for locks ${AGE_TICKS} ticks`;
}

/** After a tick: the steps skipped for locks count one more tick, every other step starts over. */
export function settleLockWaits(state: State, skipped: Set<string>): void {
  const before = state.lockWaits ?? {};
  state.lockWaits = Object.fromEntries([...skipped].map((id) => [id, (before[id] ?? 0) + 1]));
}
