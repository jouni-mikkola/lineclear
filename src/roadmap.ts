const FIELDS = ["result", "why", "done when", "parts", "files", "locks", "after", "dropped"] as const;
const REQUIRED = ["why", "done when", "locks", "after"] as const;

export interface Step {
  id: string;
  title: string;
  phase: string;
  /** 1-based line of the `### ` heading. */
  line: number;
  fields: Record<string, { value: string; line: number /** Every continuation line, as written. */; more: string[] }>;
  after: string[];
  dropped: boolean;
  /**
   * Merged once, but its recorded run is still missing: a `done when` item `Reopened: <why>`. An item, not a field of
   * its own, so a stable build that knows no such field still reads the roadmap.
   */
  reopened: boolean;
  /** Only the owner can do it by hand: a `done when` item `Owner only: <why>`, an item for the same reason as `Reopened`. */
  ownerOnly: boolean;
}

/** The longest title and result a step may have: the title fits a card's line, the result is one sentence. */
export const TITLE_MAX = 32;
const RESULT_MAX = 140;

export interface RoadmapError {
  line: number;
  message: string;
}

export interface Parsed {
  steps: Step[];
  errors: RoadmapError[];
}

/** `unproven`: merged (or closed with nothing to merge), but an item of its `done when` is recorded false. */
export type State = "done" | "dropped" | "work" | "ready" | "waiting" | "unproven";

export interface StepStatus {
  id: string;
  title: string;
  phase: string;
  state: State;
  /** For an unproven step: the first `done when` item that is not proven. */
  unproven?: string;
}

export interface Task {
  id?: string;
  title: string;
  status: string;
  /** What the task shows under its title, such as why it waits for you. */
  sub?: string;
  /** Set while the task is quiet past its stall limit. */
  stalled?: { life?: number };
  /** A done task that was closed with nothing to merge: its step was already done. */
  closed?: boolean;
  /** How it closed: only the agent's own `done` (`done`) says its step was already done; a `task close` also moves tasks. */
  closedBy?: "done" | "close";
  /** Its worktree is gone and its agent has been dead for over 2 h: nothing runs for it, so it holds no locks. */
  orphaned?: boolean;
  /** The brief with its Settings block, where "Merge: ask me first" keeps the merge for the owner. */
  desc?: string;
  /** Why its last merge stopped, as the board says it. */
  mergeStopped?: string;
  /** The owner stopped it: writing to it starts it again, so no rule writes to it. */
  stopped?: boolean;
}

const HEADING = /^### (\S+)(?: (.*))?$/;
// A build that does not know `result` skips a plain line, so a result written as "Result: ..." stays readable to it
const RESULT_LINE = /^Result: (.*)$/;
const FIELD = /^- ([^:]*):\s?(.*)$/;

/** Reads one line inside a step. Returns the field a following indented line continues, if any. */
function bodyLine(step: Step, raw: string, line: number, lastField: string | undefined, errors: RoadmapError[]): string | undefined {
  if (raw.startsWith("- ")) {
    const f = FIELD.exec(raw);
    const name = f?.[1] as string | undefined;
    if (!f || name === undefined || !(FIELDS as readonly string[]).includes(name)) {
      errors.push({ line, message: `unknown field '${name ?? raw.slice(2).trim()}' in step ${step.id}` });
      return undefined;
    }
    if (step.fields[name]) {
      errors.push({ line, message: `field '${name}' twice in step ${step.id}` });
      return undefined;
    }
    step.fields[name] = { value: f[2] ?? "", line, more: [] };
    return name;
  }
  if (RESULT_LINE.test(raw)) {
    const text = (RESULT_LINE.exec(raw)?.[1] ?? "").trim();
    if (step.fields.result) errors.push({ line, message: `field 'result' twice in step ${step.id}` });
    else step.fields.result = { value: text, line, more: [] };
    return undefined;
  }
  if (/^\s+\S/.test(raw) && lastField) {
    const cur = step.fields[lastField];
    if (cur && cur.value === "") cur.value = raw.trim();
    else if (cur) cur.more.push(raw.trimEnd());
  }
  return lastField;
}

/** Reads the roadmap format and reports the errors that need no other step: fields and duplicate ids. */
export function parseRoadmap(text: string): Parsed {
  const steps: Step[] = [];
  const errors: RoadmapError[] = [];
  const seen = new Map<string, number>();
  let phase = "";
  let step: Step | undefined;
  let lastField: string | undefined;

  const finish = () => {
    if (!step) return;
    for (const f of REQUIRED) {
      // a step that names its parts locks them: it needs a locks line only for a lock that is no part
      if (f === "locks" && step.fields.parts) continue;
      if (!step.fields[f] || step.fields[f].value.trim() === "") {
        errors.push({ line: step.line, message: `step ${step.id} has no '${f}' field` });
      }
    }
    const after = step.fields.after?.value.trim() ?? "";
    step.after = after === "" ? [] : after.split(",").map((s) => s.trim());
    step.dropped = step.fields.dropped !== undefined;
    step.reopened = (step.fields["done when"]?.more ?? []).some((l) => /^\s+- Reopened: /.test(l));
    step.ownerOnly = [step.fields["done when"]?.value ?? "", ...(step.fields["done when"]?.more ?? [])].some((l) => /^\s*- Owner only: /.test(l));
    steps.push(step);
    step = undefined;
  };

  text.split("\n").forEach((raw, i) => {
    const line = i + 1;
    const h = HEADING.exec(raw);
    if (raw.startsWith("## ")) {
      finish();
      phase = raw.slice(3).trim();
      lastField = undefined;
    } else if (raw.startsWith("# ")) {
      finish();
    } else if (h) {
      finish();
      lastField = undefined;
      const id = h[1] as string;
      const title = (h[2] ?? "").trim();
      if (title === "") errors.push({ line, message: `step ${id} has no title` });
      const first = seen.get(id);
      if (first !== undefined) errors.push({ line, message: `duplicate id ${id} (first on line ${first})` });
      else seen.set(id, line);
      step = { id, title, phase, line, fields: {}, after: [], dropped: false, reopened: false, ownerOnly: false };
    } else if (step) {
      lastField = bodyLine(step, raw, line, lastField, errors);
    }
  });
  finish();
  return { steps, errors };
}

/** The errors of the whole file, sorted by line: parse errors plus unknown and circular `after`. */
export function checkRoadmap(text: string): { parsed: Parsed; errors: RoadmapError[] } {
  const parsed = parseRoadmap(text);
  const errors = [...parsed.errors];
  const byId = new Map<string, Step>();
  for (const s of parsed.steps) if (!byId.has(s.id)) byId.set(s.id, s);

  for (const s of parsed.steps) {
    if (!s.fields.after) continue;
    const line = s.fields.after.line;
    const unknown = s.after.filter((a) => !byId.has(a) && a !== "none");
    for (const a of unknown) errors.push({ line, message: `step ${s.id} has an unknown 'after' id ${a}` });
    if (s.after.includes("none") && s.after.length > 1) {
      errors.push({ line, message: `step ${s.id} mixes 'none' with other ids in 'after'` });
    }
    if (reaches(byId, s.after, s.id)) errors.push({ line, message: `step ${s.id} is in a circular 'after'` });
  }
  errors.sort((a, b) => a.line - b.line);
  return { parsed, errors };
}

/** True when `target` can be reached by following `after` from `from`. */
function reaches(byId: Map<string, Step>, from: string[], target: string): boolean {
  const seen = new Set<string>();
  const stack = [...from];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const s = byId.get(id);
    if (s) stack.push(...s.after);
  }
  return false;
}

/**
 * Ids marked done by commit messages: subject `<TASK>: <id> ...` or a body line `Step: <id>`. The commits come newest
 * first, as `git log` gives them. A commit `Revert "<subject>"` takes the done mark from the older commit with that
 * subject, so a step whose merge was reverted is open again.
 */
export function doneIds(commits: { subject: string; body: string }[], ids: Set<string>): Set<string> {
  const done = new Set<string>();
  const reverted = new Map<string, number>();
  for (const c of commits) {
    const undone = /^Revert "(.+)"$/.exec(c.subject);
    if (undone) reverted.set(undone[1] as string, (reverted.get(undone[1] as string) ?? 0) + 1);
    const left = reverted.get(c.subject) ?? 0;
    if (left > 0) {
      reverted.set(c.subject, left - 1);
      continue;
    }
    const m = /^[A-Za-z][A-Za-z0-9]*-\d+: (\S+)(?: |$)/.exec(c.subject);
    if (m && ids.has(m[1] as string)) done.add(m[1] as string);
    for (const l of c.body.split("\n")) {
      const b = /^Step: (\S+)\s*$/.exec(l);
      if (b && ids.has(b[1] as string)) done.add(b[1] as string);
    }
  }
  return done;
}

/**
 * The step a task was started for. With the rules' record (`taskSteps`, task id to step id) only the record counts: a
 * title that begins with a step id proves nothing. Without a record (views that have no project state) the title is read.
 */
export function stepOfTask(steps: Step[], t: Task, taskSteps?: Record<string, string>): Step | undefined {
  if (taskSteps === undefined) return steps.find((x) => t.title.startsWith(`${x.id} `));
  const id = t.id === undefined ? undefined : taskSteps[t.id];
  return id === undefined ? undefined : steps.find((x) => x.id === id);
}

/**
 * Steps whose task ended Done with nothing to merge by its agent's own `done`, with that task: the step was already done
 * on main. A task closed any other way (moved to another machine, a Dispatcher close) proves nothing. Another machine's
 * task has no record, so its title (`<step id> <title>`) names its step.
 */
export function closedSteps(steps: Step[], tasks: Task[], taskSteps?: Record<string, string>, remote: Task[] = []): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of [...tasks, ...remote]) {
    if (t.status !== "done" || !t.closed || t.closedBy !== "done") continue;
    const s = stepOfTask(steps, t, remote.includes(t) ? undefined : taskSteps);
    if (s && !out.has(s.id)) out.set(s.id, t.id ?? t.title);
  }
  return out;
}

/** The heading of the section the rule loop never starts a step from. */
const FROZEN_PHASE = "Frozen by the owner";

/** A step under the owner's freeze: open and kept, but the rule loop skips it. */
export const isFrozen = (s: Step): boolean => s.phase.startsWith(FROZEN_PHASE);

/**
 * Gives each step one of the six states. Assumes the roadmap passed the check. `unproven` is the checker's record:
 * step id to its first `done when` item that is recorded false. A merged step with one is not done, and does not let
 * the steps after it start.
 */
export function stepStatuses(
  steps: Step[],
  merged: Set<string>,
  tasks: Task[],
  taskSteps?: Record<string, string>,
  remote: Task[] = [],
  unproven: ReadonlyMap<string, string> = new Map(),
): StepStatus[] {
  const done = new Set<string>([...merged, ...closedSteps(steps, tasks, taskSteps, remote).keys()]);
  const finished = new Set<string>([...done].filter((id) => !unproven.has(id)));
  for (const s of steps) if (s.dropped) finished.add(s.id);
  return steps.map((s) => {
    const missing = unproven.get(s.id);
    const open = [...tasks, ...remote].some((t) => t.status !== "done" && stepOfTask(steps, t, remote.includes(t) ? undefined : taskSteps)?.id === s.id);
    const base = { id: s.id, title: s.title, phase: s.phase };
    // a reopened step was merged once, but its own proof is still missing
    if (done.has(s.id) && !s.reopened && missing === undefined) return { ...base, state: "done" };
    if (s.dropped) return { ...base, state: "dropped" };
    if (open) return { ...base, state: "work" };
    if (done.has(s.id) && !s.reopened && missing !== undefined) return { ...base, state: "unproven", unproven: missing };
    return { ...base, state: s.after.every((a) => a === "none" || finished.has(a)) ? "ready" : "waiting" };
  });
}

/** What a step's title and result must be, with no AI: a title of at most 32 characters, a result of one sentence of at most 140. */
export function stepResultProblems(s: Step): string[] {
  const out: string[] = [];
  if (s.title.length > TITLE_MAX) out.push(`step ${s.id} has a title of ${s.title.length} characters, at most ${TITLE_MAX}: name the result in fewer words`);
  const r = s.fields.result;
  const text = r ? [r.value, ...r.more.map((l) => l.trim())].join(" ").trim() : "";
  if (text === "") out.push(`step ${s.id} has no 'result' line: one sentence on what the owner or a user can see or do once it lands`);
  else {
    if (text.length > RESULT_MAX) out.push(`step ${s.id} has a result of ${text.length} characters, at most ${RESULT_MAX}`);
    if (/[.!?]\s+[A-Z]/.test(text)) out.push(`step ${s.id} has a result of more than one sentence`);
  }
  return out;
}

/** The form errors of every step of a file, each with the line of its heading. */
export function formErrors(steps: Step[]): RoadmapError[] {
  return steps.flatMap((s) =>
    stepResultProblems(s).map((message) => ({ line: /has a title/.test(message) ? s.line : (s.fields.result?.line ?? s.line), message })),
  );
}

/** The `--result` flag for a task of this step; none when the line is missing or the server would refuse it, so an old roadmap still starts. */
export function resultFlag(s: Step): string[] {
  const text = resultOf(s);
  return text && text.length <= RESULT_MAX && !/[.!?]\s+[A-Z]/.test(text) ? ["--result", text] : [];
}

/** The result of a step as one line. */
export function resultOf(s: Step): string {
  const r = s.fields.result;
  return r ? [r.value, ...r.more.map((l) => l.trim())].join(" ").trim() : "";
}

/** A title cut to TITLE_MAX at the end of a word, so no word shows half; one long word is cut where it must be. */
export function fitTitle(title: string): string {
  const t = title.trim();
  if (t.length <= TITLE_MAX) return t;
  const cut = t.slice(0, TITLE_MAX + 1).lastIndexOf(" ");
  return (cut > 0 ? t.slice(0, cut) : t.slice(0, TITLE_MAX)).replace(/[\s,:;.-]+$/, "");
}
