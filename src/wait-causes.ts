// The wait from a step's ready to its first task's start, split by the cause the rule loop recorded: each skip line
// of the decision log holds its cause from its time until the step's next line. Minutes no skip covers say so.

const CAUSES = ["lock", "part", "slot", "machine load", "quota", "other cause", "no cause recorded"] as const;
export type Cause = (typeof CAUSES)[number];

/** The decision lines of one step: when, what kind, and why. */
export interface StepDecision {
  step: string;
  at: number;
  kind: string;
  reason: string;
}

export interface Window {
  step: string;
  /** The step was ready, in ms. */
  ready: number;
  /** Its first task started, in ms. */
  start: number;
}

export interface StepWait {
  step: string;
  /** Minutes of the wait by cause; only causes with minutes. */
  minutes: Partial<Record<Cause, number>>;
}

/** The cause a skip reason names. `parts` are the repo's part names: a lock named like one is a part held. */
function causeOf(reason: string, parts: ReadonlySet<string>): Cause {
  const lock = /^lock '(.+)' is held/.exec(reason);
  if (lock) return parts.has(lock[1] as string) || (lock[1] as string).startsWith("file:") ? "part" : "lock";
  if (/no free slot|slots from the server|kept off this machine/.test(reason)) return "slot";
  if (/^load average|load average is above/.test(reason)) return "machine load";
  if (/every account is ahead|no worker model has room|pi offers none/.test(reason)) return "quota";
  return "other cause";
}

/** Each window split by cause, in the order given. */
export function waitCauses(windows: Window[], decisions: StepDecision[], parts: ReadonlySet<string>): StepWait[] {
  return windows.map((w) => {
    const lines = decisions.filter((d) => d.step === w.step && d.at < w.start).sort((a, b) => a.at - b.at);
    const minutes: Partial<Record<Cause, number>> = {};
    let covered = 0;
    lines.forEach((d, i) => {
      if (d.kind !== "skip") return;
      const from = Math.max(d.at, w.ready);
      const to = Math.min(lines[i + 1]?.at ?? w.start, w.start);
      if (to <= from) return;
      const cause = causeOf(d.reason, parts);
      minutes[cause] = (minutes[cause] ?? 0) + (to - from) / 60_000;
      covered += to - from;
    });
    const open = (w.start - w.ready - covered) / 60_000;
    if (open > 0) minutes["no cause recorded"] = open;
    return { step: w.step, minutes };
  });
}

/** The minutes of every step summed by cause, largest first. */
export function causeTotals(waits: StepWait[]): [Cause, number][] {
  const sum = new Map<Cause, number>();
  for (const w of waits) for (const c of CAUSES) sum.set(c, (sum.get(c) ?? 0) + (w.minutes[c] ?? 0));
  return [...sum].filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1]);
}

/** One line of a step's wait: "lock 30.0 min, no cause recorded 12.0 min", largest first. */
export function causeLine(minutes: StepWait["minutes"]): string {
  return Object.entries(minutes)
    .sort((a, b) => b[1] - a[1])
    .map(([c, m]) => `${c} ${m.toFixed(1)} min`)
    .join(", ");
}

/** The steps that waited longer than `tickMs` with no recorded cause: a free step starts in the tick that sees it ready. */
export function unexplainedWaits(waits: StepWait[], tickMs: number): { step: string; minutes: number }[] {
  return waits.map((w) => ({ step: w.step, minutes: w.minutes["no cause recorded"] ?? 0 })).filter((w) => w.minutes * 60_000 > tickMs);
}

/**
 * For each lock holder that ended: the minutes its lock stayed held after its task ended, up to the end of the last skip
 * line that named it, over every step that waited, started or not. A skip with no line after it lasts to the last line of
 * the log. `endOf` is the end in ms of the holder's task that was running at `at`, undefined while it still runs.
 */
export function lockHeldAfterEnd(decisions: StepDecision[], endOf: (step: string, at: number) => number | undefined): number[] {
  const horizon = Math.max(0, ...decisions.map((d) => d.at));
  const byHolder = new Map<string, number>();
  const steps = new Set(decisions.map((d) => d.step));
  for (const step of steps) {
    const lines = decisions.filter((d) => d.step === step).sort((a, b) => a.at - b.at);
    lines.forEach((d, i) => {
      const holder = d.kind === "skip" ? /^lock '.+' is held by (\S+)/.exec(d.reason)?.[1] : undefined;
      const end = holder === undefined ? undefined : endOf(holder, d.at);
      if (holder === undefined || end === undefined) return;
      const to = lines[i + 1]?.at ?? horizon;
      if (to < end) return;
      const key = `${holder}@${end}`;
      byHolder.set(key, Math.max(byHolder.get(key) ?? 0, (to - end) / 60_000));
    });
  }
  return [...byHolder.values()];
}
