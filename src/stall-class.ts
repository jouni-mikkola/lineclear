import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { writeAtomic } from "../pi/atomic.ts";
import { dirname, join } from "node:path";
import type { Task } from "./roadmap.ts";
import type { ChatCard, StallCard } from "./stalls.ts";
import type { Decision, State } from "./rules.ts";
import { MIN } from "./time.ts";

// Every way a task or a ready step stops moving has a class. A detector in plain code sees it, the stall is recorded
// in decisions.jsonl once it passes its class's limit, its remedy is recorded with the minutes from the stall, and
// its end with the minutes it cost. `lineclear stalls` sums them by class.

/** Every decision of the rule loop, one JSON line each. */

/** The summary of the last `hours`: a stall that began before the window counts its minutes inside it. */
function stallSummary(file: string, now: Date, hours = 24): StallSummary {
  const since = new Date(now.getTime() - hours * 3_600_000);
  return summarize(readDecisionsSince(file, since.getTime() - 86_400_000), since, now);
}

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
  unknown: { label: "unknown", limit: 60, remedy: "file a fix: no class names it" },
};

/** A reason that waits for the owner, a dry run, or a declared wait: not a stall of the system. */
const OWNER = /paid key|waits for your answer|declared wait|is paused|^would |^rung 4: would/;

const PATTERNS: [RegExp, StallClass][] = [
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

const NO_LIFE_FRESH_MS = 30 * MIN;
const DONE_STATES = new Set(["done", "closed"]);

/** Stalls a task shows by itself, beside what the decisions of the tick say. */
export function taskObservations(
  tasks: Task[],
  stepOf: (t: Task) => string | undefined,
  done: Set<string>,
  cards: StallCard[],
  chat: ChatCard[],
  now: number,
  /** Tasks with a declared wait: they wait for someone, not for the system. */
  waiting: Set<string> = new Set(),
  /** Tasks whose agent never answered its brief, since when (ms). */
  unsent: Record<string, { since: number }> = {},
  /** The project's stalls so far: how long a merge has waited. */
  stalls: Record<string, StallEntry> = {},
): Observation[] {
  const out: Observation[] = [];
  const open = (t: Task) => t.id !== undefined && !DONE_STATES.has(t.status) && !waiting.has(t.id);
  for (const t of tasks) {
    const id = t.id;
    if (id === undefined || !open(t)) continue;
    const brief = unsent[id];
    if (brief) out.push({ key: id, class: "brief-unsent", evidence: `${id}: its agent never answered its brief`, since: brief.since });
    const step = stepOf(t);
    if (t.status === "need" && /^signed out/i.test(t.sub ?? "")) out.push({ key: id, class: "signed-out", evidence: `${id}: ${t.sub}` });
    if (step !== undefined && done.has(step) && (t.status === "need" || t.status === "ready")) {
      out.push({ key: id, class: "idle-after-done", evidence: `${id} is ${t.status}, but its step ${step} is merged on main` });
    }
    const card = cards.filter((c) => c.task === id).at(-1);
    if (t.status === "work" && card && now - card.at < NO_LIFE_FRESH_MS) out.push(cardObservation(id, card));
    if (t.status === "merging") out.push(mergeWait(id, stalls, now));
    const revive = chat.filter((c) => c.task === id && /outdated settings|couldn.t start it again/i.test(c.text)).at(-1);
    if (t.status === "need" && revive)
      out.push({ key: id, class: "revive-loop", evidence: `${id}: ${(revive.text.split("\n")[0] ?? "").slice(0, 160)}`, since: revive.at });
  }
  return out;
}

/** A late card is a busy task past its time; any other card says it was quiet for 20 minutes, so the stall began then. */
function cardObservation(id: string, card: StallCard): Observation {
  if (card.late) return { key: id, class: "late", evidence: `${id}: may be stuck, past its time left`, since: card.at };
  return { key: id, class: "no-sign-of-life", evidence: `${id}: may be stuck, no sign of life`, since: card.at - 20 * MIN };
}

/**
 * A merge takes minutes: one that stays queued waits behind another project's step in the shared line. After
 * MERGE_LOST_MIN its result is taken as dropped, and the stall moves to that class instead of counting twice.
 */
function mergeWait(id: string, stalls: Record<string, StallEntry>, now: number): Observation {
  const queued = stalls[`${id}|head-of-line`];
  if (stalls[`${id}|merge-lost`] || (queued && now - queued.since >= MERGE_LOST_MIN * MIN))
    return { key: id, class: "merge-lost", evidence: `${id} has been merging for over ${MERGE_LOST_MIN} min: its result was dropped` };
  return { key: id, class: "head-of-line", evidence: `${id} is merging, behind the shared check and merge line` };
}

const MERGE_LOST_MIN = 120;

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

// ---- the summary ----

interface ClassSum {
  stalls: number;
  /** Minutes the stalls cost: ended ones in full, open ones until now. */
  minutes: number;
  /** Median minutes from a stall to its remedy, or null when none ran. */
  toRemedy: number | null;
}

export interface StallSummary {
  since: string;
  until: string;
  stalls: number;
  minutes: number;
  classes: Partial<Record<StallClass, ClassSum>>;
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

/** The middle of `xs`, null for none. */
export const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const at = (i: number) => s[i] ?? 0;
  return s.length % 2 ? at(m) : (at(m - 1) + at(m)) / 2;
};

type Counting = ClassSum & { remedies: number[]; open: Map<string, number> };

/** Counts one stall, remedy or end line into its class's sum, `since` (ms) the window's start. */
function count(s: Counting, d: Decision, since: number) {
  const key = `${d.project}|${d.step ?? "-"}`;
  const t = new Date(d.time).getTime();
  const inside = t >= since;
  if (d.event === "stall") {
    if (inside) s.stalls++;
    s.open.set(key, new Date(d.since ?? d.time).getTime());
  } else if (d.event === "remedy" && typeof d.minutes === "number") {
    if (inside) s.remedies.push(d.minutes);
    // a stall the ladder saw only as its action counts once, at its action
    if (!s.open.has(key)) {
      if (inside) s.stalls++;
      s.open.set(key, t - d.minutes * MIN);
    }
  } else if (d.event === "end" && typeof d.minutes === "number") {
    const from = s.open.get(key);
    // only the minutes inside the window count
    if (from !== undefined && s.open.delete(key) && inside) s.minutes += Math.min(d.minutes, Math.round((t - Math.max(from, since)) / MIN));
  }
}

/** Stalls by class between `since` and `now`, from the stall, remedy and end lines of decisions.jsonl. */
export function summarize(decisions: Decision[], since: Date, now: Date): StallSummary {
  const classes: Partial<Record<StallClass, Counting>> = {};
  const of = (c: StallClass) => (classes[c] ??= { stalls: 0, minutes: 0, toRemedy: null, remedies: [] as number[], open: new Map<string, number>() });
  for (const d of decisions) {
    if (d.class === undefined || !(STALL_CLASSES as readonly string[]).includes(d.class)) continue;
    count(of(d.class as StallClass), d, since.getTime());
  }
  const out: StallSummary = { since: since.toISOString(), until: now.toISOString(), stalls: 0, minutes: 0, classes: {} };
  for (const c of STALL_CLASSES) {
    const s = classes[c];
    if (!s) continue;
    // an open stall costs until now, counted from the window's start at most
    for (const from of s.open.values()) s.minutes += Math.round((now.getTime() - Math.max(from, since.getTime())) / MIN);
    out.classes[c] = { stalls: s.stalls, minutes: s.minutes, toRemedy: median(s.remedies) };
    out.stalls += s.stalls;
    out.minutes += s.minutes;
  }
  return out;
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

/** The lines `lineclear stalls` prints. */
function summaryLines(s: StallSummary): string[] {
  if (s.stalls === 0) return [`no stalls since ${s.since.slice(0, 16).replace("T", " ")} UTC`];
  const lines = [`${s.stalls} ${s.stalls === 1 ? "stall" : "stalls"}, ${s.minutes} min lost, since ${s.since.slice(0, 16).replace("T", " ")} UTC`];
  const rows = Object.entries(s.classes)
    .flatMap(([c, v]) => (v ? [[c, v] as const] : []))
    .sort((a, b) => b[1].minutes - a[1].minutes);
  for (const [c, v] of rows) {
    lines.push(
      `  ${CLASS_INFO[c as StallClass].label.padEnd(22)}${String(v.stalls).padStart(4)} ${String(v.minutes).padStart(6)} min${v.toRemedy === null ? "" : `  remedy after ${v.toRemedy} min`}`,
    );
  }
  return lines;
}

export function stallsMain(args: string[], out: (l: string) => void, decisionsFile: string, now = new Date()): number {
  const json = args.includes("--json");
  const i = args.indexOf("--hours");
  const hours = i >= 0 ? Number(args[i + 1]) : 24;
  const bad = args.find((a, n) => a !== "--json" && a !== "--hours" && !(n === i + 1 && i >= 0));
  if (bad !== undefined || !(hours > 0)) {
    out("usage: lineclear stalls [--hours N] [--json]");
    return 2;
  }
  const s = stallSummary(decisionsFile, now, hours);
  if (json) out(JSON.stringify(s));
  else for (const l of summaryLines(s)) out(l);
  return 0;
}
