import { day } from "./progress.ts";
import { doneIds, parseRoadmap, type State } from "./roadmap.ts";

// The goals page of the Roadmap: each line of "Done means" (else each phase) as an outcome, with its progress, its
// expected date and how sure that is. The rule is written in docs/design.md under "Roadmap for leaders".

const DAY = 86_400_000;

/** When `open` steps are done at the pace of `merged7` steps in 7 days, from the start of the hour. Absent with no pace or over a year. */
function finishAt(open: number, merged7: number, now: number): number | undefined {
  const perStep = (7 / merged7) * DAY;
  return merged7 > 0 && open * 7 <= merged7 * 365 ? now - (now % 3_600_000) + open * perStep : undefined;
}

/** What holds a step's task: it waits for you, for a model quota, or has stalled. */
export type Hold = "you" | "quota" | "stall";
type Confidence = "done" | "on track" | "at risk" | "late";

export interface Goal {
  title: string;
  /** Where the goal stands: at work (now), ready to start (next), or still waiting on other steps (later). */
  column: "now" | "next" | "later" | "done";
  done: number;
  total: number;
  /** When its open steps are done at the pace of the last 7 days, in ms. Absent with no measured pace. */
  finish?: number;
  confidence: Confidence;
  /** Why, in one sentence. */
  reason: string;
  /** The ids of its steps, for its page of phases and steps. */
  steps: string[];
}

export interface GoalStep {
  id: string;
  title: string;
  phase: string;
  state: State;
  after: string[];
}

/** The lines under "**Done means.**" in a roadmap file, each a bullet with its continuation lines joined. */
export function doneMeansLines(text: string): string[] {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith("**Done means.**"));
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (l.startsWith("#")) break;
    if (l.startsWith("- ")) out.push(l.slice(2).trim());
    else if (/^\s+\S/.test(l) && out.length) out[out.length - 1] += ` ${l.trim()}`;
    else if (l.trim() !== "" && out.length) break;
  }
  return out;
}

const ID_REF = /\b([A-Z]+)(\d+)(?: to ([A-Z]+)(\d+))?\b/g;

/** The ids a goal line names, with "L68 to L76" read as every step between: only ids the roadmap has. */
function namedSteps(line: string, steps: GoalStep[]): string[] {
  const has = new Set(steps.map((s) => s.id));
  const found = new Set<string>();
  for (const m of line.matchAll(ID_REF)) {
    const [, prefix = "", from = "", , to] = m;
    if (to === undefined) {
      if (has.has(`${prefix}${from}`)) found.add(`${prefix}${from}`);
      continue;
    }
    for (const s of steps) {
      const r = /^([A-Z]+)(\d+)$/.exec(s.id);
      if (r?.[1] === prefix && Number(r[2]) >= Number(from) && Number(r[2]) <= Number(to)) found.add(s.id);
    }
  }
  return steps.filter((s) => found.has(s.id)).map((s) => s.id);
}

/** A goal line as the page says it: the step ids in parentheses are for the machine, not the reader. */
const goalTitle = (line: string) =>
  line
    .replace(/\s*\((?:[^()]*\b[A-Z]+\d+\b[^()]*)\)/g, "")
    .replace(/\s+([.,])/g, "$1")
    .trim();

/** The goals as rows of ids: the "Done means" lines when the roadmap has them, else its phases. */
function goalRows(text: string, steps: GoalStep[]): { title: string; ids: string[] }[] {
  const lines = doneMeansLines(text);
  const rows = lines.flatMap((line) => {
    const named = namedSteps(line, steps);
    // a line that names no step is about the whole roadmap
    const ids = named.length ? named : /\b[A-Z]+\d+\b/.test(line) ? [] : steps.map((s) => s.id);
    return ids.length ? [{ title: goalTitle(line), ids }] : [];
  });
  if (rows.length) return rows;
  return [...new Set(steps.map((s) => s.phase))].map((phase) => ({ title: phase, ids: steps.filter((s) => s.phase === phase).map((s) => s.id) }));
}

/** The longest chain of open steps that wait on each other and ends in one of `own`: the goal's critical path. */
function criticalPath(own: GoalStep[], open: Map<string, GoalStep>): GoalStep[] {
  const memo = new Map<string, GoalStep[]>();
  const chain = (s: GoalStep): GoalStep[] => {
    const known = memo.get(s.id);
    if (known) return known;
    memo.set(s.id, [s]);
    let best: GoalStep[] = [];
    for (const a of s.after) {
      const dep = open.get(a);
      if (dep) {
        const c = chain(dep);
        if (c.length > best.length) best = c;
      }
    }
    const path = [...best, s];
    memo.set(s.id, path);
    return path;
  };
  return own.map(chain).reduce<GoalStep[]>((a, b) => (b.length > a.length ? b : a), []);
}

const HOLD_TEXT: Record<Hold, string> = { you: "waits for you", quota: "waits for a model quota", stall: "has stalled" };

/** What the goals of one roadmap are judged against: the pace now and a week ago, and what holds which step. */
interface Pace {
  now: number;
  merged7: number;
  /** Steps done a week ago, and the merges in the week before that. Absent mergedThen: no step ids to read it by. */
  before: Set<string>;
  mergedThen?: number;
  holds: Map<string, Hold>;
}

/** The confidence of a goal with steps left, and why. */
function judge(own: GoalStep[], left: GoalStep[], open: Map<string, GoalStep>, p: Pace): { finish?: number; confidence: Confidence; reason: string } {
  const finish = finishAt(left.length, p.merged7, p.now);
  const then = p.now - 7 * DAY;
  const wasFinish = p.mergedThen === undefined ? undefined : finishAt(own.filter((s) => !p.before.has(s.id)).length, p.mergedThen, then);
  const out = finish ? { finish } : {};
  const held = criticalPath(left, open).find((s) => p.holds.has(s.id));
  if (held)
    return { ...out, confidence: "at risk", reason: `${held.title} ${HOLD_TEXT[p.holds.get(held.id) as Hold]}, and it is on the longest chain of this goal.` };
  // a day of slack, so the hourly rounding of both dates never makes a goal late
  if (wasFinish !== undefined && (finish === undefined || finish > wasFinish + DAY)) {
    return {
      ...out,
      confidence: "late",
      reason: finish
        ? `Expected ${day(finish)}, a week ago ${day(wasFinish)}.`
        : `A week ago it was expected ${day(wasFinish)}; now there is no pace to date it.`,
    };
  }
  const dates = finish
    ? `done about ${day(finish)} at the pace of the last 7 days`
    : "no finish date, as nothing has merged in the last 7 days to measure a pace";
  return { ...out, confidence: "on track", reason: `${left.length} of ${own.length} ${own.length === 1 ? "step" : "steps"} left, ${dates}.` };
}

/**
 * The goals of a roadmap file. `holds` says which steps' tasks wait for you, for a quota or have stalled; `commits`
 * give the pace now and 7 days ago, so a date that moved later shows as late.
 */
export function goalsOf(
  text: string,
  steps: GoalStep[],
  holds: Map<string, Hold>,
  commits: { at: number; subject: string; body: string }[],
  now: number,
): Goal[] {
  const live = steps.filter((s) => s.state !== "dropped");
  const ids = new Set(parseRoadmap(text).steps.map((s) => s.id));
  const byId = new Map(live.map((s) => [s.id, s]));
  const open = new Map(live.filter((s) => s.state !== "done").map((s) => [s.id, s]));
  // a list roadmap has no step ids in its commits, so it has no "then"
  const then = now - 7 * DAY;
  const pace: Pace = {
    now,
    holds,
    before: doneIds(
      commits.filter((c) => c.at <= then),
      ids,
    ),
    merged7: ids.size
      ? doneIds(
          commits.filter((c) => c.at > then),
          ids,
        ).size
      : 0,
    ...(ids.size
      ? {
          mergedThen: doneIds(
            commits.filter((c) => c.at <= then && c.at > then - 7 * DAY),
            ids,
          ).size,
        }
      : {}),
  };

  return goalRows(text, live).map(({ title, ids: row }): Goal => {
    const own = row.flatMap((id) => byId.get(id) ?? []);
    const left = own.filter((s) => open.has(s.id));
    const base = { title, done: own.length - left.length, total: own.length, steps: row };
    if (left.length === 0)
      return { ...base, column: "done", confidence: "done", reason: `${own.length === 1 ? "Its step is" : `All ${own.length} steps are`} merged.` };
    const column = left.some((s) => s.state === "work") ? "now" : left.some((s) => s.state === "ready") ? "next" : "later";
    return { ...base, column, ...judge(own, left, open, pace) };
  });
}
