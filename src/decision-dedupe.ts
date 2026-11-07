import { isSkipCode } from "./decision-code.ts";
import type { Decision } from "./rules.ts";

/** A line written before codes existed has only its kind. */
const codeOf = (d: Decision) => d.code ?? d.kind;

/** What a skip says about itself: its first clause, since the clauses after it (another machine's room) come and go. */
const skipHead = (reason: string) => reason.split("; ")[0] ?? reason;

/**
 * The decisions worth writing: a skip with the code of the last one for its step is not, whatever its numbers say. A
 * skip is told when it starts and, as a "no longer skipped" line, when it ends; `last` keeps `code:text` per step.
 */
export function freshDecisions(decisions: Decision[], last: Record<string, string>): Decision[] {
  return decisions.flatMap((d): Decision[] => {
    // a stall's own lines are made once each
    if (d.event !== undefined) return [d];
    const key = d.step ?? `-${d.kind}`;
    const code = codeOf(d);
    const skipped = isSkipCode(code) || d.kind === "skip";
    const value = `${code}:${skipped ? skipHead(d.reason) : d.reason}`;
    const before = last[key];
    const beforeCode = before?.slice(0, before.indexOf(":"));
    if (before !== undefined && (skipped ? beforeCode === code : before === value)) return [];
    last[key] = value;
    const wasSkipped = before !== undefined && beforeCode !== undefined && (isSkipCode(beforeCode) || beforeCode === "skip");
    const ended =
      wasSkipped && !skipped
        ? [{ ...d, kind: "wake" as const, code: "wake" as const, reason: `no longer skipped: ${before.slice(beforeCode.length + 1)}` }]
        : [];
    return [...ended, d];
  });
}
