import type { Decision } from "./rules.ts";

/** What a skip says about itself: its first clause, since the clauses after it (another machine's room) come and go. */
const skipHead = (d: Decision) => (d.kind === "skip" ? (d.reason.split("; ")[0] ?? d.reason) : d.reason);

/** The same reason with other numbers ("load average 3.2" and "3.4") is the same skip. */
const sameSaid = (a: string, b: string) => a.replace(/\d+(\.\d+)?/g, "#") === b.replace(/\d+(\.\d+)?/g, "#");

/**
 * The decisions worth writing: a repeat of the last reason for a step is not. A skip is told when it starts and, as a
 * "no longer skipped" line, when it ends; `last` keeps what each step said last.
 */
export function freshDecisions(decisions: Decision[], last: Record<string, string>): Decision[] {
  return decisions.flatMap((d): Decision[] => {
    // a stall's own lines are made once each
    if (d.event !== undefined) return [d];
    const key = d.step ?? `-${d.kind}`;
    const value = `${d.kind}:${skipHead(d)}`;
    const before = last[key];
    if (before !== undefined && sameSaid(before, value)) return [];
    last[key] = value;
    const ended = before?.startsWith("skip:") && d.kind !== "skip" ? [{ ...d, kind: "wake" as const, reason: `no longer skipped: ${before.slice(5)}` }] : [];
    return [...ended, d];
  });
}
