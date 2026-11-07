import type { Decision } from "./rules.ts";
import { decisionsSince } from "./decisions-store.ts";
import { CLASS_INFO, type StallClass, classify } from "./stall-class.ts";

/** The name a start meant for the machine that runs the rule loop is recorded and printed under. */
export const THIS_MACHINE = "this machine";

const DAY_MS = 86_400_000;

/** The stall classes that mean a start did not happen on its machine: the others (a held lock, no room) are waits. */
const START_FAILURES: (string | undefined)[] = ["brief-unsent", "machine-unreachable", "command-failed"];

export interface MachineStarts {
  machine: string;
  count: number;
  /** Each cause with its count, most often first. */
  causes: [string, number][];
}

/**
 * The failed starts of the last 24 hours per machine: the stopped starts the rule loop recorded for a machine, each by
 * the label of its stall class. Every machine in `machines` has an entry, also with none.
 */
export function failedStarts(decisions: Decision[], machines: string[], now: number): MachineStarts[] {
  const by = new Map<string, Map<string, number>>(machines.map((m) => [m, new Map()]));
  for (const d of decisions) {
    const cls = classify(d);
    if (d.machine === undefined || !START_FAILURES.includes(cls) || new Date(d.time).getTime() < now - DAY_MS) continue;
    const causes = by.get(d.machine) ?? new Map<string, number>();
    by.set(d.machine, causes);
    const label = CLASS_INFO[cls as StallClass].label;
    causes.set(label, (causes.get(label) ?? 0) + 1);
  }
  return [...by].map(([machine, causes]) => ({
    machine,
    count: [...causes.values()].reduce((a, b) => a + b, 0),
    causes: [...causes].sort((a, b) => b[1] - a[1]),
  }));
}

/** The line `lineclear doctor` prints for one machine. */
export function startsLine(m: MachineStarts): string {
  const causes = m.causes.map(([c, n]) => `${c} ${n}`).join(", ");
  return `failed starts on ${m.machine} in 24 h: ${m.count}${causes ? ` (${causes})` : ""}`;
}

/** The failed starts the decisions table holds, for the machines doctor knows. */
export function failedStartsIn(env: NodeJS.ProcessEnv, machines: string[], now: number): MachineStarts[] {
  return failedStarts(decisionsSince<Decision>(env, now - DAY_MS), machines, now);
}
