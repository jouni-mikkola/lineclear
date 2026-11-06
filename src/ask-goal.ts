// The ask goal: the owner gets fewer than three asks on each of the last three days with work.
import type { Numbers } from "./measure.ts";
import { goalSince } from "./wait-goal.ts";

/** The goal: a day with this many asks or more fails. */
const ASK_GOAL = 3;
const DAYS = 3;

export interface AskGoal {
  /** The asks of each of the last days with work, oldest first. */
  days: { date: string; asks: number }[];
}

/** The goal read from the numbers `measure` made with `since` = `goalSince(today)`; a day with work has an ask, a turn, a wait, a merge lane or a priced step. */
export function askGoal(numbers: Numbers, today: string): AskGoal {
  const from = goalSince(today);
  const worked = numbers.days.filter((d) => d.date >= from && d.date <= today && (d.asks > 0 || d.turns > 0 || d.wait || d.lane || d.cost));
  return { days: worked.slice(-DAYS).map((d) => ({ date: d.date, asks: d.asks })) };
}

/** Why the goal fails, naming each day over it; undefined when it holds. */
export function askGoalFailure(g: AskGoal): string | undefined {
  const over = g.days.filter((d) => d.asks >= ASK_GOAL);
  if (over.length === 0) return undefined;
  return `${over.map((d) => `${d.date} had ${d.asks} asks`).join(", ")}; the goal is under ${ASK_GOAL} a day. Each ask is a card or Inbox item: settle its kind by a rule (docs/asks.md) so it stops reaching the owner`;
}

/** The line `docs/numbers.md` gets for one run. */
export function askGoalLine(g: AskGoal, today: string): string {
  return `- ${today}: asks per day with work: ${g.days.length === 0 ? "-" : g.days.map((d) => `${d.date} ${d.asks}`).join(", ")}`;
}
