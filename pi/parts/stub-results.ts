// Part of the token pack: a tool result that was used some turns ago is replaced by a stub before each call, so the
// calls after it carry less. A stub changes the prompt from that result on, so the provider's cache is written again
// once (the stub is the same on every later call, so it stays cached); only a big result is worth it. Writes, edits, errors, images, the chat with the owner and state notes
// (lineclear-notes-*) are never stubbed. Imports nothing of Lineclear.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Raw = any;
type Env = Record<string, string | undefined>;
type Pi = { on: (event: string, handler: (event: Raw, ctx: Raw) => unknown) => void };

/** Turns (assistant messages) after a result before it is stubbed, unless `<config>/pack.json` says `{"stub": {"after": N}}`. */
export const AFTER = 8;
/** A result shorter than this stays: its stub would save less than the cache write costs. */
export const MIN_CHARS = 3_000;
const KEPT_START = 160;
const MARK = "[Result of ";

export const NEVER = new Set(["write", "edit"]);
const CHAT = /(?:^|[\s;&|("'])(?:\S*\/)?lineclear\s+(?:chat|ask|reply|say|wait|resume)\b/;
const NOTES = /lineclear-notes-/;

function configuredAfter(env: Env): number {
  try {
    const dir = env.LINECLEAR_CONFIG || join(env.HOME ?? homedir(), ".config", "lineclear");
    const own = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8"))?.stub?.after;
    return typeof own === "number" && own > 0 ? Math.floor(own) : AFTER;
  } catch {
    return AFTER;
  }
}

/** The text of a result made only of text; undefined for an image or an empty one. */
const textOf = (m: Raw): string | undefined => {
  const c = m?.content;
  if (!Array.isArray(c) || c.length === 0 || c.some((x: Raw) => x?.type !== "text" || typeof x.text !== "string")) return undefined;
  return c.map((x: Raw) => x.text).join("\n");
};

/** What the model sees in place of a used result: its tool, its size and its first line. */
export function stubOf(tool: string, text: string): string {
  const first = (text.split("\n").find((l) => l.trim() !== "") ?? "").slice(0, KEPT_START);
  return `${MARK}${tool} left out by the token pack: ${text.length} characters. It began: ${first} Run the tool again if you need it.]`;
}

/** `messages` with every old, big, plain result stubbed; the same array when nothing changes. */
export function stubOld(messages: Raw[], after = AFTER): Raw[] {
  // the chat and the notes are told apart by the call that made a result
  const calls = new Map<string, Raw>();
  for (const m of messages) {
    if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const c of m.content) if (c?.type === "toolCall" && c.id) calls.set(c.id, c);
  }
  let turnsAfter = 0;
  const out = [...messages];
  let changed = false;
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (m?.role === "assistant") turnsAfter++;
    if (m?.role !== "toolResult" || turnsAfter < after || m.isError || NEVER.has(m.toolName)) continue;
    const text = textOf(m);
    if (text === undefined || text.length < MIN_CHARS || text.startsWith(MARK)) continue;
    const args = calls.get(m.toolCallId)?.arguments ?? {};
    if (CHAT.test(String(args.command ?? "")) || NOTES.test(JSON.stringify(args))) continue;
    out[i] = { ...m, content: [{ type: "text", text: stubOf(String(m.toolName), text) }] };
    changed = true;
  }
  return changed ? out : messages;
}

export default function stubResults(pi: Pi, env: Env = process.env): void {
  pi.on("context", (ev) => {
    try {
      const messages = stubOld(Array.isArray(ev?.messages) ? ev.messages : [], configuredAfter(env));
      return messages === ev.messages ? undefined : { messages };
    } catch {
      return undefined; // stubbing must never get in the way of a call
    }
  });
}
