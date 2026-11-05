import { doneIds, parseRoadmap, resultOf } from "./roadmap.ts";

/** One step of a roadmap as Home counts it: a stepped step, or an item under Now, Next, Later or Done. */
interface PlanStep {
  id: string;
  title: string;
  phase: string;
  done: boolean;
  /** What the owner can see or do once it lands: one sentence, when the roadmap has it. */
  result?: string;
  /** Ids it waits for. Empty for a list roadmap, where order alone says what is next. */
  after: string[];
  /** The locks and parts it holds while it runs: two steps that share one go one at a time. */
  locks: string[];
}

export interface Plan {
  steps: PlanStep[];
}

/** Where a project is going, in words and one date. Every field is absent when it is not known. */
export interface Where {
  phase?: string;
  next?: string;
  /** What holds up the rest, by its kind, and the page that shows it when there is one. */
  blocker?: Blocker;
  /** When the roadmap is done at the pace of the last 7 days, in ms. */
  finish?: number;
}

/** A wait of one of the project's open tasks, in words. `until` is the end of a dated wait, in ms. */
export interface Blocker {
  text: string;
  href?: string;
  until?: number;
}

const SECTION = /^(now|next|later|done)\b/i;
const ITEM = /^ {0,1}(?:\d+[.)]|[-*]) +(.+)$/;
const MARKED = /^\[x\]|^~~|\(done\)|\u2713/i;

// a list item can be a whole paragraph: 72 characters is the most the line under a project fits in three lines at 390 px
const titleOf = (text: string) => {
  const bold = /^\*\*(.+?)\*\*/.exec(text);
  const t = (bold?.[1] ?? text)
    .replace(/^\[[ x]\] */i, "")
    .replace(/[*~`]/g, "")
    .trim();
  return t.length > 72 ? `${t.slice(0, 71)}…` : t;
};

/** A roadmap with Now, Next, Later and Done lists and no step ids. */
function listPlan(text: string): Plan {
  const steps: PlanStep[] = [];
  let phase: string | undefined;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("#")) {
      const h = /^##\s+(.*)$/.exec(raw);
      if (h) phase = SECTION.exec((h[1] ?? "").trim())?.[1];
      else if (!raw.startsWith("###")) phase = undefined;
      continue;
    }
    const item = phase ? ITEM.exec(raw) : null;
    if (!phase || !item) continue;
    const name = phase[0]!.toUpperCase() + phase.slice(1).toLowerCase();
    steps.push({
      id: String(steps.length + 1),
      title: plainTitle(titleOf(item[1] as string)),
      phase: name,
      done: name === "Done" || MARKED.test(item[1] as string),
      after: [],
      locks: [],
    });
  }
  return { steps };
}

/**
 * The steps of a roadmap file, either kind: ids with `after` (done from the commits on main) or lists under Now,
 * Next, Later and Done (done = under Done or marked done).
 */
export function readPlan(text: string, commits: { subject: string; body: string }[], unproven: ReadonlyMap<string, string> = new Map()): Plan {
  const parsed = parseRoadmap(text).steps.filter((s) => !s.dropped);
  if (parsed.length === 0) return listPlan(text);
  const done = doneIds(commits, new Set(parsed.map((s) => s.id)));
  return {
    steps: parsed.map((s) => ({
      id: s.id,
      title: s.title,
      ...(resultOf(s) ? { result: resultOf(s) } : {}),
      phase: s.phase,
      done: done.has(s.id) && !s.reopened && !unproven.has(s.id),
      after: s.after.filter((a) => a !== "none"),
      locks: [...(s.fields.locks?.value ?? "").split(/[,\s]+/), ...(s.fields.parts?.value ?? "").split(/[,\s]+/)].filter((l) => l !== "" && l !== "none"),
    })),
  };
}

/** Steps done and steps in all, as Home and the roadmap view both show them. A dropped step is in neither. */
export function countSteps(plan: Plan): { done: number; total: number } {
  return { done: plan.steps.filter((s) => s.done).length, total: plan.steps.length };
}

/** The first phase, in the roadmap's order, that still has an open step. */
export function currentPhase(plan: Plan): string | undefined {
  const phases = [...new Set(plan.steps.map((s) => s.phase))];
  return phases.find((p) => plan.steps.some((s) => s.phase === p && !s.done)) || undefined;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const day = (ms: number) => `${new Date(ms).getDate()} ${MONTHS[new Date(ms).getMonth()]}`;

/** A step's title as a line shows it: no task id such as "(AB-12)" or "AB-12:", and no closing full stop. */
export const plainTitle = (title: string) =>
  title
    .replace(/^[A-Z][A-Z0-9]*-\d+[:.]?\s+/, "")
    .replace(/\s*\([A-Z][A-Z0-9]*-\d+\)/g, "")
    .replace(/(?<!\.)\.$/, "")
    .trim();

/** What is next and what blocks, from the plan and the waits of the project's open tasks. */
export function whereTo(plan: Plan, waits: Blocker[], merged7: number, now: number): Where {
  const open = plan.steps.filter((s) => !s.done);
  if (open.length === 0) return {};
  const finished = new Set(plan.steps.filter((s) => s.done).map((s) => s.id));
  const startable = open.find((s) => s.after.every((a) => finished.has(a)));
  const blocker = waits[0] ?? (startable ? undefined : { text: "every open step waits for another step" });
  const perStep = merged7 > 0 ? (7 / merged7) * 86_400_000 : Infinity;
  const days = (open.length * perStep) / 86_400_000;
  // a dated wait holds up an open task, which still takes a step's time once the wait ends
  // from the start of the hour, so the answer does not change every second and the views are sent only real changes
  const hour = now - (now % 3_600_000);
  const finish = days <= 365 ? Math.max(hour + open.length * perStep, ...waits.map((w) => (w.until ? w.until + perStep : 0))) : undefined;
  return {
    phase: currentPhase(plan),
    ...(startable ? { next: plainTitle(startable.title) } : {}),
    ...(blocker ? { blocker: { text: blocker.text, ...(blocker.href ? { href: blocker.href } : {}) } } : {}),
    ...(finish ? { finish } : {}),
  };
}

/** The roadmap in one line: the counts, the estimated finish and what keeps it from coming sooner. */
export interface RoadmapLine {
  done: number;
  /** Steps whose task runs. */
  work: number;
  /** Steps whose task waits for you. */
  waiting: number;
  /** Open steps with no task yet. */
  left: number;
  total: number;
  /** When the roadmap is done at the measured pace, in ms. Absent with no measured pace. */
  finish?: number;
  /** Why the end is not sooner, in words. Absent when nothing holds it up. */
  why?: string;
  /** The step ids of the longest chain of steps that wait on each other, first step first. Absent below 2 steps. */
  path?: string[];
  /** The whole line as a sentence. */
  text: string;
}

const longer = (a: string[], b: string[]) => (b.length > a.length ? b : a);

/**
 * The critical path: the longest chain of open steps that wait on each other, first step first. On a tie the step
 * listed first wins, so the same plan always gives the same chain.
 */
export function criticalPath(open: { id: string; after: string[] }[]): string[] {
  const byId = new Map(open.map((s) => [s.id, s]));
  const memo = new Map<string, string[]>();
  const chainTo = (id: string): string[] => {
    const known = memo.get(id);
    if (known) return known;
    memo.set(id, [id]);
    let best: string[] = [];
    for (const a of byId.get(id)?.after ?? []) if (byId.has(a)) best = longer(best, chainTo(a));
    const chain = [...best, id];
    memo.set(id, chain);
    return chain;
  };
  return open.map((s) => chainTo(s.id)).reduce(longer, []);
}

/** The most steps that wait on each other in a row, and the most open steps that share one lock. */
function longestHolds(open: PlanStep[]): { chain: number; shared: number } {
  const users = new Map<string, number>();
  for (const s of open) for (const l of new Set(s.locks)) users.set(l, (users.get(l) ?? 0) + 1);
  return { chain: criticalPath(open).length, shared: Math.max(0, ...users.values()) };
}

const steps = (n: number) => `${n} ${n === 1 ? "step" : "steps"}`;

/**
 * The line every roadmap shows at its top, `lineclear roadmap status` prints first and Home's data carries. `marks` says
 * which open steps have a task and whether it waits for you; `where` is `whereTo`'s answer for the same plan.
 */
export function roadmapLine(plan: Plan, marks: Map<string, "work" | "need">, where: Where, merged7: number): RoadmapLine {
  const open = plan.steps.filter((s) => !s.done);
  const waiting = open.filter((s) => marks.get(s.id) === "need").length;
  const work = open.filter((s) => marks.get(s.id) === "work").length;
  const left = open.length - waiting - work;
  const counts = { done: plan.steps.length - open.length, work, waiting, left, total: plan.steps.length };
  if (open.length === 0) return { ...counts, text: `${counts.total === 1 ? "The only step is" : `All ${counts.total} steps are`} done.` };
  const { chain, shared } = longestHolds(open);
  const structure =
    chain >= 2 && chain >= shared
      ? `${steps(chain)} wait on each other in a row`
      : shared >= 2
        ? `${steps(shared)} use the same part and go one at a time`
        : undefined;
  // a wait on a task names its id: the line says "another task"
  // the path is shown only when the chain is the reason the line gives (it gives none without a date): a wait or a shared lock named instead is not it
  const chainIsWhy = Boolean(where.finish) && !where.blocker && chain >= 2 && chain >= shared;
  const why = where.blocker?.text.replace(/\b[A-Z][A-Z0-9]*-\d+(?:@\S+)?/g, "another task") ?? structure;
  const sums = `${counts.done} done, ${work} at work, ${waiting} waiting for you, ${left} left`;
  const when = where.finish
    ? `Done about ${day(where.finish)} at the pace of the last 7 days${why ? `, not sooner: ${why}` : ""}.`
    : merged7 === 0
      ? "No finish date yet: nothing has merged in the last 7 days to measure a pace."
      : "No finish date: at this pace it is more than a year away.";
  return {
    ...counts,
    ...(where.finish ? { finish: where.finish } : {}),
    ...(why ? { why } : {}),
    ...(chainIsWhy ? { path: criticalPath(open) } : {}),
    text: `${sums}. ${when}`,
  };
}

/** Steps whose merge landed in the last 7 days: the roadmap's own pace. Absent for a list roadmap, which has no step ids. */
function stepsMerged7(text: string, commits: { at: number; subject: string; body: string }[], now: number): number | undefined {
  const ids = new Set(parseRoadmap(text).steps.map((s) => s.id));
  if (ids.size === 0) return undefined;
  return doneIds(
    commits.filter((c) => c.at >= now - 7 * 86_400_000),
    ids,
  ).size;
}

/** The line of a roadmap file, from the commits on main, the tasks that work on its steps and the waits that hold them. */
export function lineOf(
  text: string,
  commits: { at: number; subject: string; body: string }[],
  marks: Map<string, "work" | "need">,
  stops: Blocker[],
  now: number,
  fallbackMerged7 = 0,
  unproven: ReadonlyMap<string, string> = new Map(),
): { line: RoadmapLine; where: Where } {
  const plan = readPlan(text, commits, unproven);
  const merged7 = stepsMerged7(text, commits, now) ?? fallbackMerged7;
  const where = whereTo(plan, stops, merged7, now);
  return { line: roadmapLine(plan, marks, where, merged7), where };
}
