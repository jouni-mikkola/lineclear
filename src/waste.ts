// The waste watch's rules: what counts as waste, each limit with its reason, and the check of the facts against them.
// Pure: src/waste-facts.ts reads the facts and src/waste-watch.ts files the fixes and tells Home. No project names here.

/** One class of waste: what it is called, its limit and why the limit is there. */
export interface Limit {
  /** What Home says after "Waste:". */
  what: string;
  limit: number;
  unit: string;
  reason: string;
}

export const LIMITS = {
  starts: {
    what: "step started again and again",
    limit: 3,
    unit: "starts of one step in 24 h",
    reason: "a step starts once, and twice more after a real stop: a fourth start is a loop that burns tokens.",
  },
  unmerged: {
    what: "tasks closed without a merge",
    limit: 20,
    unit: "% of tasks ended in 24 h",
    reason: "a task that ends with no merge spent its tokens for nothing; one in five is a leak, not noise.",
  },
  lockSkips: {
    what: "a lock skips starts",
    limit: 60,
    unit: "skips of one lock in 1 h",
    reason: "a lock that skips more than every minute is held by work that does not end, or the part split is too wide.",
  },
  idleSlots: {
    what: "ready steps wait with slots free",
    limit: 10,
    unit: "lock skips of one ready step in 1 h while a slot is free",
    reason: "a free slot and a ready step that do not meet is capacity thrown away.",
  },
  redMerges: {
    what: "merge checks fail",
    limit: 30,
    unit: "% of merge checks in 24 h (at least 5)",
    reason: "a red merge check costs the whole check again; more than three in ten means the inner check lets too much through.",
  },
  redNoTest: {
    what: "red checks name no test",
    limit: 2,
    unit: "red merge checks in 24 h with no failed test named",
    reason: "a red run no test explains is a broken tool or machine, which a retry will not mend.",
  },
  forks: {
    what: "processes forked",
    limit: 100,
    unit: "forks per second",
    reason: "a machine that forks this fast spends its time on process starts, and a poll loop is the usual cause.",
  },
  apiSlow: {
    what: "board API is slow",
    limit: 3000,
    unit: "ms, 95th percentile in 10 min",
    reason: "the board is read from a phone: past 3 s the owner waits on every tap.",
  },
  tokens: {
    what: "tokens per merged step",
    limit: 15_000_000,
    unit: "tokens",
    reason: "a step that costs this much more than the median is rework or a loop, not work.",
  },
  scope: {
    what: "check far larger than the change",
    limit: 120,
    unit: "seconds of check for a change in docs only",
    reason: "a check that runs everything for a text change is waiting for nothing.",
  },
} satisfies Record<string, Limit>;

type WasteId = keyof typeof LIMITS;

/** What the watch read: counts the limits are held against. */
export interface Facts {
  /** Starts in the last 24 h per project step, as "project step". */
  starts: Record<string, number>;
  /** Tasks that ended in the last 24 h, and of them those that did not merge. */
  ended: { total: number; unmerged: number };
  /** Lock skips in the last hour per "project lock", and per ready "project step" with the free slots it saw. */
  lockSkips: Record<string, number>;
  stepSkips: Record<string, number>;
  freeSlots: number;
  /** Merge-tier check runs in the last 24 h, the red ones, and those red with no failed test named. */
  merge: { runs: number; red: number; redNoTest: number };
  forksPerSecond?: number;
  apiP95Ms?: number;
  tokensPerStep?: number | null;
  /** Merge-tier runs whose change was in docs only: the seconds each took, with the branch. */
  docsOnlyRuns: { branch: string; seconds: number }[];
}

export interface Alarm {
  id: WasteId;
  /** The number that passed its limit, in words: Home says it. */
  number: string;
  /** The evidence lines of the fix task. */
  evidence: string[];
}

const top = (by: Record<string, number>) => Object.entries(by).sort((a, b) => b[1] - a[1])[0];
const MIN_ENDED = 5;
const MIN_MERGE_RUNS = 5;

/** The alarms whose limit the facts pass, in the order of LIMITS. */
export function alarms(f: Facts): Alarm[] {
  const out: Alarm[] = [];
  const add = (id: WasteId, number: string, evidence: string[]) => out.push({ id, number, evidence });
  const starts = top(f.starts);
  if (starts && starts[1] > LIMITS.starts.limit) {
    const many = Object.entries(f.starts).filter(([, n]) => n > LIMITS.starts.limit);
    add(
      "starts",
      `${starts[1]} starts of ${starts[0]}`,
      many.map(([k, n]) => `${k}: ${n} starts in 24 h`),
    );
  }
  const share = f.ended.total >= MIN_ENDED ? (100 * f.ended.unmerged) / f.ended.total : 0;
  if (share > LIMITS.unmerged.limit) {
    add("unmerged", `${Math.round(share)} %`, [`${f.ended.unmerged} of ${f.ended.total} tasks ended in 24 h without a merge (${Math.round(share)} %)`]);
  }
  const lock = top(f.lockSkips);
  if (lock && lock[1] > LIMITS.lockSkips.limit)
    add(
      "lockSkips",
      `${lock[1]} skips an hour by ${lock[0]}`,
      Object.entries(f.lockSkips).map(([k, n]) => `${k}: ${n} skips in 1 h`),
    );
  const waiting = Object.entries(f.stepSkips).filter(([, n]) => n >= LIMITS.idleSlots.limit);
  if (waiting.length > 0 && f.freeSlots > 0) {
    add(
      "idleSlots",
      `${waiting.length} ready, ${f.freeSlots} slots free`,
      waiting.map(([k, n]) => `${k}: ${n} lock skips in 1 h, ${f.freeSlots} slots free`),
    );
  }
  const red = f.merge.runs >= MIN_MERGE_RUNS ? (100 * f.merge.red) / f.merge.runs : 0;
  if (red > LIMITS.redMerges.limit) add("redMerges", `${Math.round(red)} % red`, [`${f.merge.red} of ${f.merge.runs} merge checks in 24 h failed`]);
  if (f.merge.redNoTest >= LIMITS.redNoTest.limit)
    add("redNoTest", `${f.merge.redNoTest} in 24 h`, [`${f.merge.redNoTest} red merge checks named no failed test`]);
  if (f.forksPerSecond !== undefined && f.forksPerSecond > LIMITS.forks.limit)
    add("forks", `${Math.round(f.forksPerSecond)} forks/s`, [`${f.forksPerSecond.toFixed(1)} processes forked per second since the last look`]);
  if (f.apiP95Ms !== undefined && f.apiP95Ms > LIMITS.apiSlow.limit)
    add("apiSlow", `p95 ${(f.apiP95Ms / 1000).toFixed(1)} s`, [`the board API's 95th percentile is ${f.apiP95Ms} ms (median of the last 10 minutes)`]);
  if (f.tokensPerStep != null && f.tokensPerStep > LIMITS.tokens.limit)
    add("tokens", `${(f.tokensPerStep / 1e6).toFixed(1)} M per step`, [`${Math.round(f.tokensPerStep)} tokens per merged step in 14 days`]);
  const big = f.docsOnlyRuns.filter((r) => r.seconds > LIMITS.scope.limit);
  if (big.length > 0)
    add(
      "scope",
      `${Math.round(Math.max(...big.map((r) => r.seconds)))} s for a docs change`,
      big.map((r) => `${r.branch}: a docs-only change was checked for ${Math.round(r.seconds)} s`),
    );
  return out;
}

/** The line Home shows. */
export const wasteLine = (a: Pick<Alarm, "id" | "number">) => `Waste: ${LIMITS[a.id].what}, ${a.number}`;
