import { doneIds, parseRoadmap } from "./roadmap.ts";
import { type Blocker, day, type Plan, readPlan, type Where, whereTo } from "./progress.ts";

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
function longestHolds(open: Plan["steps"]): { chain: number; shared: number } {
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
  merged?: Set<string>,
): { line: RoadmapLine; where: Where } {
  const plan = readPlan(text, commits, unproven, merged);
  const merged7 = stepsMerged7(text, commits, now) ?? fallbackMerged7;
  const where = whereTo(plan, stops, merged7, now);
  return { line: roadmapLine(plan, marks, where, merged7), where };
}
