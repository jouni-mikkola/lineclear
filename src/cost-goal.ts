// The cost goal: the cost per merged step of the last three days stays at $1.18 or less, 15 % below the pilot's $1.39.
import type { Numbers } from "./measure.ts";

/** The goal in dollars: a cost above it fails. */
const COST_GOAL = 1.18;

const CAUSE_NAMES: Record<string, string> = { input: "fresh input", output: "output", cacheRead: "cache read", cacheWrite: "cache write" };

export interface CostGoal {
  /** Dollars per merged step over the window, null when no step was priced. */
  perStep: number | null;
  steps: number;
  /** The cause with the largest share of the cost, null when none. */
  largestCause: string | null;
}

/** The goal read from the numbers `measure` made over the window; days weigh by their steps. */
export function costGoal(numbers: Numbers): CostGoal {
  const costed = numbers.days.flatMap((d) => (d.cost ? [d.cost] : []));
  const steps = costed.reduce((a, c) => a + c.steps, 0);
  const top = [...numbers.causes].sort((a, b) => b.share - a.share)[0];
  return {
    perStep: steps === 0 ? null : costed.reduce((a, c) => a + c.perStep * c.steps, 0) / steps,
    steps,
    largestCause: top && top.share > 0 ? `${CAUSE_NAMES[top.cause] ?? top.cause} (${(top.share * 100).toFixed(1)} %)` : null,
  };
}

/** Why the goal fails, naming the largest cost share; undefined when it holds. */
export function costGoalFailure(g: CostGoal): string | undefined {
  if (g.perStep === null || g.perStep <= COST_GOAL) return undefined;
  return `cost per merged step is $${g.perStep.toFixed(2)} over ${g.steps} steps, the goal is $${COST_GOAL.toFixed(2)} or less; largest share: ${g.largestCause ?? "none recorded"}`;
}

/** The line `docs/numbers.md` gets for one run. */
export function costGoalLine(g: CostGoal, today: string): string {
  return `- ${today}: ${g.perStep === null ? "-" : `$${g.perStep.toFixed(2)}`} per merged step over ${g.steps} steps`;
}
