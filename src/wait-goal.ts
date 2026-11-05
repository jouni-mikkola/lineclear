// The wait goal: the median wait from ready to start of the last three days stays under five minutes.
import { DAY, measure, median, type Measured, type Numbers } from "./measure.ts";
import { causeTotals } from "./wait-causes.ts";

/** The goal in minutes: a median at or above it fails. */
const WAIT_GOAL_MIN = 5;
const DAYS = 3;

export interface WaitGoal {
  /** Median minutes of the waits of the last three days, null when none started. */
  median: number | null;
  /** Waits counted on each of the days, oldest first. */
  counts: { date: string; tasks: number }[];
  /** The cause with the most minutes, null when no wait has one. */
  largestCause: string | null;
}

/** The first day of the window that ends on `today` (YYYY-MM-DD). */
export const goalSince = (today: string) => new Date(Date.parse(`${today}T00:00:00Z`) - (DAYS - 1) * DAY).toISOString().slice(0, 10);

/** The goal read from the numbers `measure` made with `since` = `goalSince(today)`. */
export function waitGoal(numbers: Numbers, today: string): WaitGoal {
  const top = causeTotals(numbers.waitCauses)[0];
  return {
    median: numbers.waitMinutes.length === 0 ? null : median(numbers.waitMinutes),
    counts: Array.from({ length: DAYS }, (_, i) => {
      const date = new Date(Date.parse(`${goalSince(today)}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10);
      return { date, tasks: numbers.days.find((d) => d.date === date)?.wait?.tasks ?? 0 };
    }),
    largestCause: top ? `${top[0]} (${top[1].toFixed(1)} min)` : null,
  };
}

export const waitGoalOf = (m: Measured, today: string) => waitGoal(measure(m, goalSince(today)), today);

/** Why the goal fails, naming the largest cause; undefined when it holds. */
export function waitGoalFailure(g: WaitGoal): string | undefined {
  if (g.median === null || g.median < WAIT_GOAL_MIN) return undefined;
  return `median wait from ready to start is ${g.median.toFixed(1)} min over the last ${DAYS} days, the goal is under ${WAIT_GOAL_MIN} min; largest cause: ${g.largestCause ?? "none recorded"}`;
}

/** The lines `docs/numbers.md` gets under "L238" for one run. */
export function waitGoalLine(g: WaitGoal, today: string): string {
  const counts = g.counts.map((c) => `${c.date} ${c.tasks}`).join(", ");
  return `- ${today}: median ${g.median === null ? "-" : `${g.median.toFixed(1)} min`}; waits per day: ${counts}`;
}

/** `text` with the run's line added under the "## <heading>" section (made at the end if missing); a second run of a day replaces its line. */
export function appendGoalLine(text: string, line: string, heading = "L238"): string {
  const day = line.slice(0, line.indexOf(":") + 1);
  const lines = text.replace(/\n+$/, "").split("\n");
  const at = lines.indexOf(`## ${heading}`);
  if (at < 0) return `${lines.join("\n")}\n\n## ${heading}\n\n${line}\n`;
  let end = at + 1;
  while (end < lines.length && !(lines[end] as string).startsWith("## ")) end++;
  while (end > at + 1 && lines[end - 1] === "") end--;
  const same = lines.findIndex((l, i) => i > at && i < end && l.startsWith(day));
  if (same >= 0) lines[same] = line;
  else lines.splice(end, 0, line);
  if (lines[at + 1] !== "") lines.splice(at + 1, 0, "");
  return `${lines.join("\n")}\n`;
}
