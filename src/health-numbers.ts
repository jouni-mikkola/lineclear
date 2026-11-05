import { existsSync, readFileSync } from "node:fs";
import { writeAtomic } from "../pi/atomic.ts";
import type { Decision } from "./rules.ts";
import { median, summarize } from "./stall-class.ts";

// Whether Lineclear stays on the rails, as five numbers: the share of task time spent waiting on the system (a stall,
// not the owner), stalls per day, minutes from a stall to its remedy, merges per day and tokens per merged step.
// `lineclear measure <project> --since <day> --health` writes them to docs/numbers.md under "Health".

const DAY = 86_400_000;
const MIN = 60_000;

export interface Health {
  since: string;
  until: string;
  /** Stall minutes over task minutes in the range, or null when no task ran. Goal: near 0. */
  systemWait: number | null;
  stallsPerDay: number;
  /** Median minutes from a stall to its remedy, or null when no remedy ran. */
  toRemedy: number | null;
  mergesPerDay: number;
  /** Mean tokens of a merged step, or null when no merged step had all its sessions. */
  tokensPerStep: number | null;
}

export interface HealthInput {
  project: string;
  decisions: Decision[];
  /** Each task's run: its start, and its end (merged or closed) or none while it runs. */
  tasks: { start?: number; end?: number }[];
  /** The times of the steps merged in the range. */
  merges: number[];
  /** The tokens of each merged step with all its sessions found. */
  stepTokens: number[];
  since: Date;
  now: Date;
}

export function health(h: HealthInput): Health {
  const from = h.since.getTime();
  const to = h.now.getTime();
  const days = Math.max(1, (to - from) / DAY);
  const own = h.decisions.filter((d) => d.project === h.project);
  const s = summarize(own, h.since, h.now);
  // the remedies one by one, not a median of medians
  const remedies = own.filter((d) => d.event === "remedy" && typeof d.minutes === "number" && new Date(d.time).getTime() >= from).map((d) => Number(d.minutes));
  let taskMinutes = 0;
  for (const t of h.tasks) {
    if (t.start === undefined) continue;
    const a = Math.max(t.start, from);
    const b = Math.min(t.end ?? to, to);
    if (b > a) taskMinutes += (b - a) / MIN;
  }
  const merges = h.merges.filter((t) => t >= from && t <= to).length;
  return {
    since: h.since.toISOString(),
    until: h.now.toISOString(),
    systemWait: taskMinutes > 0 ? Math.min(1, s.minutes / taskMinutes) : null,
    stallsPerDay: s.stalls / days,
    toRemedy: median(remedies),
    mergesPerDay: merges / days,
    tokensPerStep: h.stepTokens.length ? h.stepTokens.reduce((a, b) => a + b, 0) / h.stepTokens.length : null,
  };
}

const fmt = (v: number | null, digits: number, unit = "") => (v === null ? "-" : `${v.toFixed(digits)}${unit}`);

/** The measures as table rows: name, value, goal. */
function healthRows(x: Health): [string, string, string][] {
  return [
    ["share of task time waiting on the system", fmt(x.systemWait === null ? null : x.systemWait * 100, 1, " %"), "near 0, lower is better"],
    ["stalls per day", fmt(x.stallsPerDay, 1), "lower is better"],
    ["minutes from a stall to its remedy (median)", fmt(x.toRemedy, 0), "lower is better"],
    ["merges per day", fmt(x.mergesPerDay, 1), "higher is better"],
    ["tokens per merged step", x.tokensPerStep === null ? "-" : String(Math.round(x.tokensPerStep)), "lower is better"],
  ];
}

export function healthLines(x: Health): string[] {
  return healthRows(x).map(([n, v]) => `${n}: ${v}`);
}

/** docs/numbers.md with its "Health" section set to these numbers, put right after the title. */
export function withHealth(text: string, project: string, x: Health): string {
  const section = [
    "## Health",
    "",
    `\`lineclear measure ${project} --since ${x.since.slice(0, 10)} --health\`, until ${x.until.slice(0, 16).replace("T", " ")} UTC.`,
    "Stalls count from L112, when the rule loop began to record them. A step that makes one of these worse fails its review.",
    "",
    "| Measure | Value | Goal |",
    "| --- | --- | --- |",
    ...healthRows(x).map(([n, v, g]) => `| ${n} | ${v} | ${g} |`),
    "",
  ].join("\n");
  const lines = text.split("\n");
  const at = lines.indexOf("## Health");
  if (at >= 0) {
    const next = lines.findIndex((l, i) => i > at && /^## /.test(l));
    return [...lines.slice(0, at), section, ...(next >= 0 ? lines.slice(next) : [])].join("\n");
  }
  const second = lines.findIndex((l) => /^## /.test(l));
  if (second < 0) return `${text.trimEnd()}\n\n${section}`;
  return [...lines.slice(0, second), section, ...lines.slice(second)].join("\n");
}

export function writeHealth(file: string, project: string, x: Health) {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "# Numbers\n";
  writeAtomic(file, withHealth(text, project, x));
}
