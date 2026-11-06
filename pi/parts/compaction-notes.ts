// Part of the token pack: notes before a compaction. pi's own summary is one more model call that sends the whole
// history again. Instead, once before a session reaches its compaction point, this asks it for a state file under set
// headings, and at the compaction builds the summary from that file with no model call. A missing, old or too long
// file falls back to pi's own summary, and the log says why. Coordinators, the Dispatcher and sessions you run
// yourself are the longest sessions: they get the notes too, and the owner's direction log after each compaction,
// since their owner's words would otherwise live only in the chat. Imports nothing of Lineclear outside pi/.
import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { rolePoint } from "../compaction.ts";
import { appendDirection, directionLogFile, directionTail, ownerStatement } from "../direction-log.ts";

type Env = Record<string, string | undefined>;
type Pi = {
  on: (event: string, handler: (event: any, ctx: any) => unknown) => void;
  sendUserMessage?: (content: string, options?: { deliverAs?: "steer" | "followUp" }) => unknown;
  sendMessage?: (message: { customType: string; content: string; display: boolean }, options?: { triggerTurn?: boolean }) => unknown;
};

/** The headings the state file must have, in this order. */
export const HEADINGS = ["Done", "In progress", "Next", "Decisions", "Open"];
/** The longest state file asked for, in characters. */
export const MAX_FILE = 6_000;
/** How far past MAX_FILE a file may run and still be used: a small overrun is no reason to lose the notes. */
export const OVERRUN = 600;
/** Turns after the ask with no state file before it is asked once more. */
export const REASK_AFTER = 3;
/** The share of the compaction point at which the agent is asked: late, so the notes cover what pi summarises. */
export const ASK_SHARE = 0.9;
/** pi's own reserve when its settings name none. */
export const DEFAULT_RESERVE = 16_384;
/** The first line of the ask, so the ask is not counted among the user's messages. */
export const MARK = "[lineclear notes]";

/** The most owner's messages a coordinator's or your own session's summary keeps word for word: the newest ones. */
export const MAX_MESSAGES = 20;

/**
 * Who is asked: a task's agent (a worker or a planner), a coordinator or the Dispatcher (a space's chat, no task), or a
 * session with no chat (one you run yourself). A reviewer is short-lived and is not.
 */
export type Role = "agent" | "coordinator" | "own";
export function roleOf(env: Env = process.env): Role | undefined {
  const chat = env.LINECLEAR_CHAT ?? "";
  if (chat.endsWith("/Agent")) return "agent";
  if (chat.includes("/")) return undefined;
  return chat !== "" || env.LINECLEAR_ROLE === "dispatcher" ? "coordinator" : "own";
}

/** The name of a session's notes and log lines: its task, its chat, or its process for a session with no chat. */
const whoOf = (env: Env) => (env.LINECLEAR_CHAT ?? "").split("/")[0] || (env.LINECLEAR_ROLE === "dispatcher" ? "dispatcher" : `session-${process.pid}`);

const piAgentDir = (env: Env) => env.PI_CODING_AGENT_DIR || join(env.HOME ?? homedir(), ".pi", "agent");

/** The token count at which pi compacts a model: its window less its reserve, as pi's settings say (the pack's `compaction` part sets them). */
export function compactionPoint(window: number, model: string | undefined, env: Env = process.env): number {
  let settings: any;
  try {
    settings = JSON.parse(readFileSync(join(piAgentDir(env), "settings.json"), "utf8"));
  } catch {
    settings = undefined;
  }
  const own = model ? settings?.compaction?.modelOverrides?.[model]?.reserveTokens : undefined;
  const base = settings?.compaction?.reserveTokens;
  const reserve = [own, base].find((r) => typeof r === "number" && r >= 0) ?? DEFAULT_RESERVE;
  const piPoint = Math.max(0, window - reserve);
  const role = rolePoint(env);
  return role === undefined ? piPoint : Math.min(piPoint, role);
}

/** The session's state file, in its task's or chat's folder in the temporary folder. */
export function stateFile(env: Env = process.env): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : "x";
  return join(env.TMPDIR || tmpdir(), `lineclear-notes-${uid}`, whoOf(env).replace(/[^A-Za-z0-9_.-]/g, "_"), "state.md");
}

/** The log of compactions built from notes and those that fell back, for the numbers. */
export function logFile(env: Env = process.env): string {
  return join(env.LINECLEAR_STATE || join(env.HOME ?? homedir(), ".local", "state", "lineclear"), "pack", "compaction-notes.jsonl");
}

/** The log's lines; none before the first compaction. */
export function logLines(env: Env = process.env): string[] {
  try {
    return readFileSync(logFile(env), "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** Compactions, those that fell back and their share, from the log's lines. */
export function notesStats(logLines: string[]) {
  let used = 0,
    fellBack = 0;
  for (const l of logLines) {
    let e: any;
    try {
      e = JSON.parse(l);
    } catch {
      continue;
    }
    if (e?.ev === "used") used++;
    else if (e?.ev === "fallback") fellBack++;
  }
  const compactions = used + fellBack;
  return { compactions, used, fellBack, share: compactions ? fellBack / compactions : 0 };
}

/** What the agent is asked. */
export function ask(file: string): string {
  return [
    `${MARK} The context is near its compaction. Write your state to ${file} now, under exactly these headings, in under ${MAX_FILE} characters:`,
    ...HEADINGS.map((h) => `## ${h}`),
    "Facts only: what is done, what you are in the middle of, the next steps, what you decided and why, and what is open. The first message, the owner's messages and the changed files are added for you. Then carry on.",
  ].join("\n");
}

/** The one ask again, when the file is missing or cannot be used. */
export function askAgain(file: string, why: string): string {
  return `${MARK} Your state file ${file} cannot be used yet: ${why}. Write it again now under exactly the headings ${HEADINGS.map((h) => `## ${h}`).join(", ")}, in under ${MAX_FILE} characters. Then carry on.`;
}

/** The text under each heading, or why the file cannot be used. */
export function parseState(text: string): { sections: Record<string, string> } | { error: string } {
  if (text.length > MAX_FILE + OVERRUN) return { error: `state file too long (${text.length} characters, the most is ${MAX_FILE})` };
  const sections: Record<string, string> = {};
  let at: string | undefined;
  for (const line of text.split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      at = HEADINGS.find((h) => h.toLowerCase() === m[1]!.toLowerCase());
      if (at) sections[at] = "";
      continue;
    }
    if (at) sections[at] += `${line}\n`;
  }
  const missing = HEADINGS.filter((h) => sections[h] === undefined);
  if (missing.length > 0) return { error: `state file lacks the headings: ${missing.join(", ")}` };
  for (const h of HEADINGS) sections[h] = sections[h]!.trim();
  return { sections };
}

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((b: any) => b?.type === "text")
          .map((b: any) => String(b.text ?? ""))
          .join("\n")
      : "";

/** The user's messages on the branch, word for word, without our own ask and Lineclear's own tagged lines. */
export function userMessages(entries: any[]): string[] {
  const out: string[] = [];
  for (const e of entries ?? []) {
    if (e?.type !== "message" || e.message?.role !== "user") continue;
    const t = textOf(e.message.content);
    if (t !== "" && !t.startsWith(MARK) && !t.trimStart().startsWith("<lineclear>")) out.push(t);
  }
  return out;
}

/** The files changed so far: those of earlier compactions (their details) and of this one. */
export function changedFiles(entries: any[], fileOps: any): string[] {
  const all = new Set<string>();
  for (const e of entries ?? []) if (e?.type === "compaction" && Array.isArray(e.details?.changed)) for (const f of e.details.changed) all.add(String(f));
  for (const set of [fileOps?.written, fileOps?.edited]) for (const f of set ?? []) all.add(String(f));
  return [...all].sort();
}

/**
 * The summary: the task, the owner's messages, the files changed and the agent's notes. A task's agent keeps every
 * message of its owner; a coordinator's chat runs for days, so it keeps the newest and the log holds the rest.
 */
export function buildSummary(sections: Record<string, string>, messages: string[], changed: string[], role: Role = "agent", env: Env = process.env): string {
  const [task = "", ...all] = messages;
  const rest = role === "agent" ? all : all.slice(-MAX_MESSAGES);
  const parts = [`## ${role === "agent" ? "Task" : "First message"}\n${task}`];
  if (rest.length < all.length) {
    const where = role === "coordinator" ? `the owner's direction log, ${directionLogFile(env)}` : "the session file";
    parts.push(`${all.length - rest.length} earlier messages of the owner are in ${where}.`);
  }
  if (rest.length > 0) parts.push(`## Owner's messages (word for word)\n${rest.map((m, i) => `${i + 1}. ${m}`).join("\n\n")}`);
  parts.push(`## Files changed\n${changed.length ? changed.map((f) => `- ${f}`).join("\n") : "none"}`);
  for (const h of HEADINGS) parts.push(`## ${h}\n${sections[h] || "nothing"}`);
  return parts.join("\n\n");
}

/** What a coordinator or your own session is given after each compaction: the newest lines of the owner's direction log. */
export function directionMessage(env: Env = process.env): string | undefined {
  const { lines, earlier } = directionTail(env);
  if (lines.length === 0) return undefined;
  const more = earlier > 0 ? ` ${earlier} older lines are in ${directionLogFile(env)}.` : "";
  return `${MARK} The owner's direction log, newest last, word for word. It holds after the compaction: the newest line wins where two differ.${more}\n${lines.join("\n")}`;
}

export default function compactionNotes(pi: Pi, env: Env = process.env): void {
  const role = roleOf(env);
  if (role === undefined) return;
  const file = stateFile(env);
  let askedAt: number | undefined;
  let turnsSinceAsk = 0;
  let askedAgain = false;
  const log = (ev: object) => {
    try {
      const f = logFile(env);
      mkdirSync(join(f, ".."), { recursive: true });
      appendFileSync(f, `${JSON.stringify({ t: new Date().toISOString(), who: whoOf(env), ...ev })}\n`);
    } catch {
      // the log is a courtesy
    }
  };
  /** The state file's sections, or why it cannot be used. */
  const readState = (): { sections: Record<string, string> } | { error: string } => {
    let text: string, mtime: number;
    try {
      text = readFileSync(file, "utf8");
      mtime = statSync(file).mtimeMs;
    } catch {
      return { error: "no state file" };
    }
    if (askedAt === undefined || mtime < askedAt) return { error: "state file older than the ask" };
    return parseState(text);
  };
  const newCycle = () => {
    askedAt = undefined;
    turnsSinceAsk = 0;
    askedAgain = false;
  };

  // the owner's words in a coordinator's chat go to the log the moment they arrive, before any compaction can drop them
  pi.on("input", (ev) => {
    try {
      if (role !== "coordinator" || ev?.source === "extension" || typeof ev?.text !== "string" || ev.text.startsWith(MARK)) return undefined;
      const said = ownerStatement(ev.text);
      if (said !== undefined) appendDirection(said, whoOf(env), env);
    } catch {
      // a log that cannot be written never stops the session
    }
    return undefined;
  });

  // once per cycle, when the context passes ASK_SHARE of the compaction point; only on a turn that goes on (it made
  // tool calls), so the ask never wakes a run that was ending. After the ask, a file that is missing for a few turns
  // or cannot be used is asked for once more, with the reason, while there is still time before the compaction.
  const maybeAskAgain = () => {
    if (askedAgain) return;
    turnsSinceAsk++;
    const state = readState();
    if (!("error" in state)) return;
    const notYet = state.error === "no state file" || state.error === "state file older than the ask";
    if (notYet && turnsSinceAsk < REASK_AFTER) return;
    askedAgain = true;
    pi.sendUserMessage?.(askAgain(file, state.error), { deliverAs: "steer" });
  };
  pi.on("turn_end", (ev, ctx) => {
    try {
      if (!(Array.isArray(ev?.toolResults) && ev.toolResults.length > 0)) return undefined;
      if (askedAt !== undefined) {
        maybeAskAgain();
        return undefined;
      }
      const usage = ctx?.getContextUsage?.();
      if (!usage || typeof usage.tokens !== "number" || !(usage.contextWindow > 0)) return undefined;
      const m = ctx?.model;
      const point = compactionPoint(usage.contextWindow, m?.provider && m?.id ? `${m.provider}/${m.id}` : undefined, env);
      if (usage.tokens < point * ASK_SHARE) return undefined;
      mkdirSync(join(file, ".."), { recursive: true });
      askedAt = Date.now();
      pi.sendUserMessage?.(ask(file), { deliverAs: "steer" });
    } catch {
      // asking must never get in the way of a turn
    }
    return undefined;
  });

  pi.on("session_before_compact", (ev) => {
    const prep = ev?.preparation;
    const fallback = (reason: string) => {
      log({ ev: "fallback", reason, trigger: ev?.reason });
      newCycle();
      return undefined;
    };
    try {
      if (!prep) return fallback("no preparation from pi");
      if (ev.customInstructions) return fallback("the compaction came with instructions of its own");
      const parsed = readState();
      if ("error" in parsed) return fallback(parsed.error);
      const entries = ev.branchEntries ?? [];
      const changed = changedFiles(entries, prep.fileOps);
      const summary = buildSummary(parsed.sections, userMessages(entries), changed, role, env);
      // the notes replace pi's summary: their size, about four characters to a token, is what the context holds of the past
      log({ ev: "used", trigger: ev.reason, tokensBefore: prep.tokensBefore, notesTokens: Math.ceil(summary.length / 4) });
      newCycle();
      return { compaction: { summary, firstKeptEntryId: prep.firstKeptEntryId, tokensBefore: prep.tokensBefore, details: { changed } } };
    } catch (e) {
      return fallback(`error: ${(e as Error)?.message ?? e}`);
    }
  });

  // after any compaction, from notes or pi's own: a session beside the tasks gets the owner's direction back
  pi.on("session_compact", () => {
    try {
      if (role === "agent") return undefined;
      const text = directionMessage(env);
      if (text !== undefined) pi.sendMessage?.({ customType: "lineclear-direction", content: text, display: true }, { triggerTurn: false });
    } catch {
      // giving it back must never get in the way of the session
    }
    return undefined;
  });
}
