// Reading a Lineclear needs-you card: what it is about, and whether its agent only ended its turn.

export type AskKind = "allowance" | "merge-chat" | "login" | "permission" | "plan" | "question" | "report";

export interface Card {
  id?: string;
  task?: string;
  status?: string;
  text?: string;
  ask?: { reply?: { text?: string }; questions?: { title?: string; kind?: string }[]; choices?: string[] };
}

/** What the card of an agent that only ended its turn says: the status word, not a question. */
export const IDLE_TEXT = "Waits for your reply";

/** The card's line as a person reads it: no "needs you:" prefix, the Inbox itself says that. */
export const lineOf = (text: string) => text.replace(/^needs you:\s*/i, "").trim();

export const replyText = (c: Card) => c.ask?.reply?.text ?? "";

export function askKind(c: Card): AskKind {
  const text = `${c.text ?? ""}\n${replyText(c)}`;
  // a card with a question is never an allowance notice, whatever its words
  if (c.ask?.questions === undefined && /out of allowance|hit your (session|usage) limit/i.test(text)) return "allowance";
  if (/lineclear merge/i.test(replyText(c)) && /new message|uusi viesti/i.test(replyText(c))) return "merge-chat";
  const q = c.ask?.questions?.[0];
  if (q === undefined) return "report";
  if (/terminal is waiting/i.test(q.title ?? "")) return "permission";
  if (q.kind === "Plan") return "plan";
  if (/\b(log ?in|sign[ -]?in|authenticator)\b|\bapprove\b.*\b(push|number)\b/i.test(q.title ?? "")) return "login";
  return "question";
}

/** A card of an agent whose turn ended with no question, no wait and no choice card. */
export const isIdle = (c: Card) => askKind(c) === "report" && lineOf(c.text ?? "") === IDLE_TEXT && questionIn(replyText(c)) === undefined;

/** The last sentence of an agent's last paragraph that asks something, cut short: a plain-text question is a real one. */
export function questionIn(reply: string): string | undefined {
  const last =
    reply
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\S+:\/\/\S+/g, "")
      .trim()
      .split(/\n\s*\n/)
      .at(-1) ?? "";
  const q = last.split(/\n+|(?<=[.!?])\s+(?=\S)/).findLast((x) => /\?(?=[\s"'”’)\]*_]|$)/.test(x.replace(/`[^`]*`/g, "")));
  const line = q
    ?.replace(/^\s*(?:[-*+>]|\d+[.)])\s+/, "")
    .replace(/[*_`]+/g, "")
    .trim();
  return line ? (line.length > 90 ? `${line.slice(0, 89).trimEnd()}…` : line) : undefined;
}

/** The written rule for a step question, or the Dispatcher's way when no rule fits. An agent decides and goes on. */
export function stepRule(question: string): string {
  if (/merge (now|or wait)|wait (to|for) merge/i.test(question)) return "Merge now when your check and your review passed. Wait only for a wait you declared.";
  if (/reviewer/i.test(question))
    return "The rules pick the reviewer: the first model of another company than yours, from the project's list. Use the one the brief names.";
  if (/flak|intermittent/i.test(question))
    return "Run the test once more. If it passes, go on and note it in your facts. If it fails again it is a real failure: fix it.";
  return "Decide it from your brief and the roadmap, take the safer choice, and list the decision in your facts.";
}
