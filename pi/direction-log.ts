// The owner's direction log: every owner statement in a coordinator's or the Dispatcher's chat, one line each, with
// its time, word for word. It lives in the task store's folder, outside any one session, so a compaction loses none
// of it: the compaction-notes part writes it and gives its newest lines back after each compaction.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type Env = Record<string, string | undefined>;

/** The most lines given back after a compaction: the newest ones. */
const TAIL_LINES = 40;
/** The longest line given back, in characters: a pasted log would crowd out the rest; the log keeps it whole. */
const MAX_GIVEN = 1_000;

/** The log, beside Shepherdr's tasks.json in the task store's folder. */
export function directionLogFile(env: Env = process.env): string {
  return join(env.LINECLEAR_HOME || env.LINECLEAR_SHEPHERDR_DIR || join(env.HOME ?? homedir(), ".lineclear"), "owner-direction.md");
}

/** A tag's attributes: their quoted values may hold `>`, which Shepherdr does not escape. */
const ATTRS = `(?:\\s+[a-z-]+="[^"]*")*`;
const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/** The tags that carry the owner's own words between them, and what is said before the words to place them. */
const WORDS: Record<string, (attrs: string) => string | undefined> = {
  reply: () => undefined,
  answer: (a) => attr(a, "question"),
  "artifact-comment": (a) => attr(a, "title") && `On ${attr(a, "title")}:`,
  "artifact-sent": (a) => attr(a, "title") && `On ${attr(a, "title")}:`,
  "artifact-note": (a) => attr(a, "title") && `On ${attr(a, "title")}${attr(a, "on") ? `, ${attr(a, "on")}` : ""}:`,
  "browser-notes": (a) => attr(a, "url") && `Browser notes on ${attr(a, "url")}:`,
};

/**
 * The owner's words in one chat message, or undefined when it holds none: Shepherdr's own tagged lines, reactions and
 * files alone are not the owner's words; plain words, a reply, an answer to a card, a comment or note on an artifact
 * and the shared browser's notes are, with any words written after the tag. The lines a file or reaction adds on
 * their own are left out. A message that starts with `<` but holds no tag of Shepherdr's is plain words.
 */
export function ownerStatement(text: string): string | undefined {
  const t = text
    .split("\n")
    .filter((l) => !new RegExp(`^\\s*<[a-z-]+${ATTRS}\\s*/>\\s*$`).test(l))
    .join("\n")
    .trim();
  if (t === "") return undefined;
  const m = t.match(new RegExp(`^<([a-z-]+)(${ATTRS})\\s*>([\\s\\S]*?)</\\1>([\\s\\S]*)$`));
  if (!m) return t.startsWith("<shepherdr") ? undefined : t;
  const place = WORDS[m[1] ?? ""];
  const words = [m[3]?.trim(), m[4]?.trim()].filter(Boolean).join("\n");
  if (!place || !words) return undefined;
  const before = place(m[2] ?? "");
  return before ? `${before} ${words}` : words;
}

/** One line of the log: local time, where it was said, the words whole, their line breaks shown as " / ". */
function logLine(statement: string, where: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const time = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
  return `- ${time} (${where}): ${statement.replace(/\s*\n\s*/g, " / ")}`;
}

/** Adds one statement to the log. */
export function appendDirection(statement: string, where: string, env: Env = process.env, now = new Date()): void {
  const file = directionLogFile(env);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${logLine(statement, where, now)}\n`);
}

/** The newest lines of the log, oldest first, and how many came before them. */
export function directionTail(env: Env = process.env, max = TAIL_LINES): { lines: string[]; earlier: number } {
  let all: string[];
  try {
    all = readFileSync(directionLogFile(env), "utf8")
      .split("\n")
      .filter((l) => l.startsWith("- "));
  } catch {
    return { lines: [], earlier: 0 };
  }
  const cut = (l: string) => (l.length > MAX_GIVEN ? `${l.slice(0, MAX_GIVEN)} (cut: the whole line is in ${directionLogFile(env)})` : l);
  return { lines: all.slice(-max).map(cut), earlier: Math.max(0, all.length - max) };
}
