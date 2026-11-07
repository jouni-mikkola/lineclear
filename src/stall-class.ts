import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { writeAtomic } from "../pi/atomic.ts";
import { dirname, join } from "node:path";
import type { Decision, State } from "./rules.ts";
import { MIN } from "./time.ts";

// Every way a task or a ready step stops moving has a class. A detector in plain code sees it, the stall is recorded
// in decisions.jsonl once it passes its class's limit, its remedy is recorded with the minutes from the stall, and
// its end with the minutes it cost.

/** Every decision of the rule loop, one JSON line each. */

const STALL_CLASSES = [
  "signed-out",
  "account-full",
  "revive-loop",
  "idle-after-done",
  "main-red",
  "lock-held",
  "no-room",
  "no-sign-of-life",
  "late",
  "brief-unsent",
  "roadmap-broken",
  "repo-off-main",
  "command-failed",
  "machine-unreachable",
  "head-of-line",
  "merge-lost",
  "coordinator-gone",
  "fix-loop",
  "unknown",
] as const;
export type StallClass = (typeof STALL_CLASSES)[number];

export interface ClassInfo {
  /** What it is, in a few plain words. */
  label: string;
  /** Minutes it may last before it counts as a stall. */
  limit: number;
  /** What the stall ladder does about it. */
  remedy: string;
}

export const CLASS_INFO: Record<StallClass, ClassInfo> = {
  "signed-out": { label: "signed out", limit: 0, remedy: "hand the step to the next model (rung 3)" },
  "account-full": { label: "account full", limit: 0, remedy: "hand the step to the next model with room, or wait for the reset" },
  "revive-loop": { label: "revive loop", limit: 0, remedy: "tell the agent to carry on once, instead of reviving it again" },
  "idle-after-done": { label: "idle after done", limit: 30, remedy: "close the task: its step is merged" },
  "main-red": { label: "main red", limit: 0, remedy: "start a fix task, and revert the merge after a second failure" },
  "lock-held": { label: "lock held too long", limit: 240, remedy: "remind the task that holds the lock" },
  "no-room": { label: "no room", limit: 120, remedy: "start on another machine of the project that has room (L44)" },
  "no-sign-of-life": { label: "no sign of life", limit: 0, remedy: "the ladder: a reminder, a restart, the next model, the Inbox" },
  late: { label: "late", limit: 0, remedy: "ask the agent for a new estimate once; the ladder climbs only if no status comes" },
  "brief-unsent": { label: "brief never sent", limit: 0, remedy: "press Enter, then send the brief again" },
  "roadmap-broken": { label: "roadmap broken", limit: 30, remedy: "file a fix for the roadmap" },
  "repo-off-main": { label: "repo folder off main", limit: 60, remedy: "file a fix: the repo folder must be clean and on main" },
  "command-failed": { label: "a command fails", limit: 30, remedy: "try again on the next tick, then file a fix" },
  "machine-unreachable": { label: "machine out of reach", limit: 60, remedy: "run the project's steps on its other machines" },
  "head-of-line": {
    label: "head-of-line block across projects",
    limit: 30,
    remedy: "file a fix: one project's step holds the shared check and merge line for every project",
  },
  "merge-lost": { label: "merge result lost", limit: 0, remedy: "tell the task to bring its branch up to date and merge again" },
  "coordinator-gone": { label: "coordinator gone", limit: 30, remedy: "file a fix: the project's coordinator does not run" },
  "fix-loop": { label: "fix loop", limit: 0, remedy: "file a fix: a step's last two fix tasks ended with no merge, so no third is filed" },
  unknown: { label: "unknown", limit: 60, remedy: "file a fix: no class names it" },
};

/** A reason that waits for the owner, a dry run, or a declared wait: not a stall of the system. */
const OWNER = /paid key|waits for your answer|declared wait|is paused|^would |^rung 4: would/;

const PATTERNS: [RegExp, StallClass][] = [
  [/no \w+ fix task started: fix loop: /, "fix-loop"],
  [/signed out/i, "signed-out"],
  [/outdated settings|couldn.t start it again|revive loop/i, "revive-loop"],
  [
    /account of .* is out|is full until|is out until|no worker model has room|no reviewer model .* has room|no model is next|usage limit|hit its \w+ limit/,
    "account-full",
  ],
  [/never started|never answered|herdr has no agent for it/, "brief-unsent"],
  [/past its time left/, "late"],
  [/may be stuck|no sign of life|rung [123]:/, "no-sign-of-life"],
  [/health command failed|health failed|new starts are stopped/, "main-red"],
  [/lock '.*' is held by/, "lock-held"],
  [/no free slot|load average is above|cannot read the space's slots/, "no-room"],
  [/roadmap is broken/, "roadmap-broken"],
  [/not at origin\/main/, "repo-off-main"],
  [/^machine \S+ skipped/, "machine-unreachable"],
  [/coordinator\b.*\b(is gone|is not running|cannot restart|could not restart)/i, "coordinator-gone"],
  [/isn.t through after|another merge into this repo still runs/, "head-of-line"],
  [/failed|cannot read|did not give JSON|could not|pi offers none/, "command-failed"],
];

/** The class of a decision's reason; `owner` when it waits for the owner; undefined when it is no stop at all. */
export function classify(d: Pick<Decision, "kind" | "reason">): StallClass | "owner" | undefined {
  if (d.kind !== "skip" && d.kind !== "stall") return undefined;
  // the item after the colon is the roadmap's done-when text, not Lineclear's words
  if (/^\S+ is merged, unproven:/.test(d.reason)) return undefined;
  if (OWNER.test(d.reason)) return "owner";
  if (/is back: its limit has reset|^stall |^remedy /.test(d.reason)) return undefined;
  for (const [re, c] of PATTERNS) if (re.test(d.reason)) return c;
  return d.kind === "skip" ? "unknown" : undefined;
}

/** A stall decision that is the ladder acting on the stall, not only seeing it. */
const REMEDY =
  /^rung [1-4]:|pressed Enter|^typed its brief nudge|^restarted |^marked start failed|sent its brief nudge|started a fix task|was reverted|waits until|is out until|is full until|^asked |^closed |^told |^reminded /;

export interface Observation {
  key: string;
  class: StallClass;
  evidence: string;
  /** When it began, if known before this tick (ms). */
  since?: number;
}

/** Where each stall of a project stands: kept in the project's state, so a restart loses none. */
export interface StallEntry {
  class: StallClass;
  /** When it began (ms). */
  since: number;
  evidence: string;
  /** When it passed its limit and was recorded (ms). */
  recorded?: number;
  /** When its remedy ran (ms). */
  remedied?: number;
}

/** Acts on a stall the ladder has no rung for. Returns the decision reason, or undefined when it did nothing. */
export type Remedy = (o: Observation, entry: StallEntry) => string | undefined;

/**
 * Keeps the project's stalls: tags each decision of the tick with its class, records a stall once it passes its
 * limit, a remedy with the minutes from the stall, and the end of a stall with the minutes it cost. Returns the new
 * decisions; the tagged ones are changed in place.
 */
export function watchStalls(
  project: string,
  state: State,
  decisions: Decision[],
  observed: Observation[],
  now: Date,
  remedy: Remedy = () => undefined,
): Decision[] {
  const at = now.getTime();
  const time = now.toISOString();
  state.stalls ??= {};
  const stalls = state.stalls;
  const seen = new Map<string, Observation>();
  const add = (o: Observation) => {
    const k = `${o.key}|${o.class}`;
    if (!seen.has(k)) seen.set(k, o);
  };
  for (const o of observed) add(o);
  const remedied: { k: string; reason: string; d: Decision }[] = [];
  for (const d of decisions) {
    const c = classify(d);
    if (c === undefined || c === "owner") continue;
    d.class = c;
    const key = d.step ?? "-";
    // the ladder's own action is the remedy of its class's stall; seeing the class is enough to observe it too
    if (d.kind === "stall" && REMEDY.test(d.reason)) remedied.push({ k: `${key}|${c}`, reason: d.reason, d });
    else add({ key, class: c, evidence: d.reason });
  }
  const out: Decision[] = [];
  const note: Note = (step, c, reason, extra) => out.push({ time, project, ...(step === "-" ? {} : { step }), kind: "stall", class: c, reason, ...extra });
  for (const [k, o] of seen) {
    stalls[k] ??= { class: o.class, since: Math.min(o.since ?? at, at), evidence: o.evidence };
    keepStall(stalls[k], o, at, remedy, note);
  }
  for (const r of remedied) ladderActed(stalls, r, at, seen);
  for (const [k, e] of Object.entries(stalls)) {
    if (seen.has(k)) continue;
    delete stalls[k];
    if (e.recorded === undefined) continue;
    const [key] = k.split("|") as [string];
    const minutes = Math.round((at - e.since) / MIN);
    note(key, e.class, `stall ${e.class} ended after ${minutes} min`, { event: "end", minutes });
  }
  return out;
}

type Note = (step: string, c: StallClass, reason: string, extra: Partial<Decision>) => void;

/** One stall seen this tick: recorded once it passes its limit, then its remedy tried until one runs. */
function keepStall(e: StallEntry, o: Observation, at: number, remedy: Remedy, note: Note) {
  e.evidence = o.evidence;
  if (e.recorded === undefined && at - e.since >= CLASS_INFO[o.class].limit * MIN) {
    e.recorded = at;
    note(o.key, o.class, `stall ${o.class}: ${o.evidence}`, { event: "stall", since: new Date(e.since).toISOString() });
  }
  if (e.recorded === undefined || e.remedied !== undefined) return;
  const did = remedy(o, e);
  if (did === undefined) return;
  e.remedied = at;
  note(o.key, o.class, `remedy ${o.class}: ${did}`, { event: "remedy", minutes: Math.round((at - e.since) / MIN) });
}

/** The ladder's own action: the remedy of its stall, which it also counts as seen. */
function ladderActed(stalls: Record<string, StallEntry>, r: { k: string; reason: string; d: Decision }, at: number, seen: Map<string, Observation>) {
  // the ladder acted on a stall seen before: its minutes count from then; else the stall began with the action
  const [key, c] = r.k.split("|") as [string, StallClass];
  const entry = stalls[r.k] ?? { class: c, since: at, evidence: r.reason, recorded: at };
  stalls[r.k] = entry;
  entry.recorded ??= at;
  if (entry.remedied === undefined) {
    entry.remedied = at;
    r.d.event = "remedy";
    r.d.minutes = Math.round((at - entry.since) / MIN);
  }
  seen.set(r.k, { key, class: c, evidence: r.reason });
}

/** Decisions from `since`, read from the end of the file so a long one costs little. When `since` is older than the
 *  file's first line, the months rotateDecisions moved to archive/ are read too. */
export function readDecisionsSince(file: string, since: number): Decision[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split("\n");
  const out: Decision[] = [];
  let whole = true;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l) continue;
    try {
      const d = JSON.parse(l) as Decision;
      if (new Date(d.time).getTime() < since) {
        whole = false;
        break;
      }
      out.push(d);
    } catch {}
  }
  out.reverse();
  if (!whole) return out;
  const archive = join(dirname(file), "archive");
  if (!existsSync(archive)) return out;
  const from = `decisions-${new Date(since).toISOString().slice(0, 7)}.jsonl`;
  const old: Decision[] = [];
  for (const f of readdirSync(archive)
    .filter((f) => f.startsWith("decisions-") && f >= from)
    .sort()) {
    for (const l of readFileSync(join(archive, f), "utf8").split("\n")) {
      if (!l) continue;
      try {
        const d = JSON.parse(l) as Decision;
        if (new Date(d.time).getTime() >= since) old.push(d);
      } catch {}
    }
  }
  return [...old, ...out];
}

const KEEP_DECISIONS_MS = 90 * 86_400_000;

/** Moves the lines of decisions.jsonl older than KEEP_DECISIONS_MS to archive/decisions-<month>.jsonl, so the file the
 *  rule loop reads every tick stays small. Returns how many lines moved. */
export function rotateDecisions(file: string, now: Date): number {
  if (!existsSync(file)) return 0;
  const cut = now.getTime() - KEEP_DECISIONS_MS;
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const byMonth = new Map<string, string[]>();
  let i = 0;
  for (; i < lines.length; i++) {
    let time: number;
    try {
      time = new Date((JSON.parse(lines[i] ?? "") as Decision).time).getTime();
    } catch {
      continue;
    }
    if (!(time < cut)) break;
    const m = new Date(time).toISOString().slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) ?? []), lines[i] ?? ""]);
  }
  if (i === 0) return 0;
  const archive = join(dirname(file), "archive");
  mkdirSync(archive, { recursive: true });
  // the archive is written first: a stop in between keeps a line twice, never loses it
  for (const [m, ls] of byMonth) appendFileSync(join(archive, `decisions-${m}.jsonl`), `${ls.join("\n")}\n`);
  const rest = lines.slice(i);
  writeAtomic(file, rest.length ? `${rest.join("\n")}\n` : "");
  return i;
}

/** The day of the last cut, kept beside decisions.jsonl. */
const cutMarkPath = (file: string) => join(dirname(file), "decisions-cut-day");

/** Once a day, old lines of decisions.jsonl go to the archive. Returns how many moved, 0 when today's cut is done. */
export function cutDecisionsDaily(file: string, now: Date): number {
  const mark = cutMarkPath(file);
  const today = now.toISOString().slice(0, 10);
  if (existsSync(mark) && readFileSync(mark, "utf8").trim() >= today) return 0;
  const moved = rotateDecisions(file, now);
  mkdirSync(dirname(mark), { recursive: true });
  writeAtomic(mark, `${today}\n`);
  return moved;
}
