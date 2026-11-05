import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { logFile as compactionLog } from "../pi/parts/compaction-notes.ts";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir, decisionsPath } from "../pi/config.ts";
import type { Item } from "./inbox.ts";

// One stream of what each part of Lineclear does, read from the logs that already hold it (the rule loop's
// decisions, the model moves, the token pack's compaction log, the Inbox). Only what no log holds is written to
// events.jsonl: a review round and an update. Nothing is copied, and nothing here asks a model.

const PARTS = ["dispatcher", "planner", "rules", "workers", "reviewers", "inbox", "updates"] as const;
export type PartName = (typeof PARTS)[number];

/** `start` and `end` bracket work; `switch` is a model change, `skip` a step the rules held back, `fail` a break. */
const EVENT_KINDS = ["start", "end", "switch", "skip", "fail"] as const;
type EventKind = (typeof EVENT_KINDS)[number];

export interface PartEvent {
  /** ISO time. */
  t: string;
  part: PartName;
  kind: EventKind;
  /** One plain line: what happened, with its numbers. */
  text: string;
  /** The task or step it is about. */
  task?: string;
  /** Pairs a start with its end: a task's run, a review, an Inbox item. A start with no end after it is work still going. */
  ref?: string;
}

/** Events are kept this long. */
const KEEP_MS = 7 * 24 * 3600_000;
/** events.jsonl is cut to the last 7 days when it passes this size. */
const PRUNE_BYTES = 256 * 1024;

const eventsPath = (env: NodeJS.ProcessEnv) => join(configDir(env), "events.jsonl");

const isPart = (x: unknown): x is PartName => PARTS.includes(x as PartName);
const isKind = (x: unknown): x is EventKind => EVENT_KINDS.includes(x as EventKind);

/** Writes an event no other log holds. */
export function recordEvent(e: Omit<PartEvent, "t"> & { t?: string }, env: NodeJS.ProcessEnv = process.env, now = () => new Date()): PartEvent {
  const event: PartEvent = { ...e, t: e.t ?? now().toISOString() };
  mkdirSync(configDir(env), { recursive: true });
  appendFileSync(eventsPath(env), `${JSON.stringify(event)}\n`);
  pruneEvents(env, now().getTime());
  return event;
}

/** The file holds 7 days: once it is large, what is older goes. */
function pruneEvents(env: NodeJS.ProcessEnv, now: number): void {
  const path = eventsPath(env);
  if (statSync(path).size < PRUNE_BYTES) return;
  const kept = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => {
      try {
        return Date.parse(JSON.parse(l).t) >= now - KEEP_MS;
      } catch {
        return false;
      }
    });
  writeAtomic(path, kept.length ? `${kept.join("\n")}\n` : "");
}

/** A line of any of the logs; each reader looks only at the fields it knows. */
interface Row {
  t: string;
  time: string;
  part: string;
  kind: string;
  text: string;
  step?: string;
  task?: string;
  who?: string;
  reason?: string;
  from?: string;
  to?: string;
  why?: string;
  ev?: string;
  notesTokens?: number;
  tokensBefore?: number;
}

const cache = new Map<string, { sig: string; rows: Row[] }>();

/** The JSON lines of a file, read again only when the file changed; a half-written line is skipped. */
function lines(path: string): Row[] {
  if (!existsSync(path)) return [];
  const st = statSync(path);
  const sig = `${st.size}:${st.mtimeMs}`;
  const hit = cache.get(path);
  if (hit?.sig === sig) return hit.rows;
  const rows: Row[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    try {
      if (line.trim() !== "") rows.push(JSON.parse(line));
    } catch {
      // read again next time
    }
  }
  cache.set(path, { sig, rows });
  return rows;
}

const k = (n: number) => `${Math.round(n / 1000)}k`;

function fromDecision(d: Row): PartEvent[] {
  const task = typeof d.step === "string" ? d.step : undefined;
  const base = { t: d.time, part: "rules" as const, ...(task ? { task } : {}) };
  const reason = String(d.reason ?? "");
  if (/^plan /.test(reason)) return [{ ...base, part: "planner", kind: "skip", text: `${task ?? "A plan"}: ${reason}` }];
  const who = task ? `${task}: ` : "";
  switch (d.kind) {
    case "start": {
      // the step is handed on (the rule's moment) and its worker starts: no log says when a run ends, the count does
      const text = `${who}${reason || "started"}`;
      return [{ ...base, kind: "start", text }, ...(task ? [{ ...base, part: "workers" as const, kind: "start" as const, text }] : [])];
    }
    case "skip":
      return [{ ...base, kind: "skip", text: `${who}held, ${reason}` }];
    case "wake":
      return [{ ...base, kind: "start", text: `${who}woken, ${reason}` }];
    case "stall":
    case "stop":
      return [{ ...base, kind: "fail", text: `${who}${d.kind === "stall" ? "stalled" : "stopped"}, ${reason}` }];
    case "close":
      return [{ ...base, kind: "end", text: `${who}closed, ${reason}` }];
  }
  return [];
}

/** The task a compaction line names; a session with no task logs a name that is not one. */
const taskOf = (c: Row): string | undefined => {
  const w = c.who ?? c.task;
  return typeof w === "string" && w !== "dispatcher" && !w.startsWith("session-") ? w : undefined;
};

function fromCompaction(e: Row, task: string | undefined): PartEvent | undefined {
  const base = { t: e.t, part: "workers" as const, ...(task ? { task } : {}) };
  const who = task ? `${task}: ` : "";
  if (e.ev === "used") {
    const after = typeof e.notesTokens === "number" ? ` into ${k(e.notesTokens)} of notes` : " into notes";
    return { ...base, kind: "end", text: `${who}compacted ${typeof e.tokensBefore === "number" ? k(e.tokensBefore) : "its context"}${after}` };
  }
  if (e.ev === "fallback") return { ...base, kind: "skip", text: `${who}compaction fell back to pi's summary, ${e.reason}` };
  return undefined;
}

/** Every event of the last seven days, oldest first. `items` are the Inbox's, which the caller has already read. */
export function readEvents(env: NodeJS.ProcessEnv, items: Item[], now = Date.now()): PartEvent[] {
  const out: PartEvent[] = [];
  for (const d of lines(decisionsPath(env))) {
    out.push(...fromDecision(d));
  }
  const movesFile = join(configDir(env), "moves.jsonl");
  for (const m of lines(movesFile))
    out.push({ t: m.time, part: "workers", kind: "switch", ...(m.task ? { task: m.task } : {}), text: `${m.task ?? m.step}: ${m.from} to ${m.to}, ${m.why}` });
  for (const c of lines(compactionLog(env))) {
    const e = fromCompaction(c, taskOf(c));
    if (e) out.push(e);
  }
  for (const i of items) {
    out.push({ t: i.since, part: "inbox", kind: "start", task: i.task, text: i.question, ref: `inbox:${i.n}` });
    const at = i.answeredAt ?? i.closedAt;
    if (at)
      out.push({
        t: at,
        part: "inbox",
        kind: "end",
        task: i.task,
        ref: `inbox:${i.n}`,
        text: i.answer ? `answered: ${i.answer}` : `closed, ${i.closed ?? "no longer needed"}`,
      });
  }
  for (const e of lines(eventsPath(env)))
    if (isPart(e.part) && isKind(e.kind) && typeof e.text === "string") out.push({ ...(e as PartEvent), ref: (e as PartEvent).ref ?? e.task });
  return out.filter((e) => Date.parse(e.t) >= now - KEEP_MS).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

/** `lineclear event <part> <kind> "<text>" [--task <id>]`: puts an event no log holds, such as a review round. */
export function eventMain(args: string[], out: (l: string) => void, env: NodeJS.ProcessEnv = process.env): number {
  const at = args.indexOf("--task");
  const task = at >= 0 ? args[at + 1] : undefined;
  const rest = args.filter((_, i) => i !== at && i !== at + 1);
  const [part, kind, ...words] = rest;
  const text = words.join(" ").trim();
  if (!isPart(part) || !isKind(kind) || !text) {
    out(`usage: lineclear event <${PARTS.join("|")}> <${EVENT_KINDS.join("|")}> "<text>" [--task <id>]`);
    return 2;
  }
  recordEvent({ part, kind, text, ...(task ? { task } : {}) }, env);
  return 0;
}

/** What `/api/events` answers: the last 500 events, and the Dispatcher's turn, which is live in its chat and in no log. */
export function eventsAnswer(env: NodeJS.ProcessEnv, items: Item[], chat: { writing?: boolean; doing?: string }) {
  return { events: readEvents(env, items).slice(-500), live: chat.writing ? { dispatcher: chat.doing || "Answering" } : {} };
}
