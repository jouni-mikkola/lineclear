// The nudge a quiet turn gets, shared by the rule loop (src/asks.ts) and the pi extension, so both say the same.

/** Its last message promises the next action instead of taking it or declaring a wait. */
export const promisesNext = (reply: string) =>
  /\b(i['’]?ll|i will|i am going to|i['’]?m going to)\s+(keep|continue|try|check|call|run|retry|wait|look|come back|monitor|poll)/i.test(reply);

/** The nudge an idle agent gets for each quiet turn. */
export const IDLE_NUDGE =
  'Your turn ended with no question and no declared wait, so you are not in the owner\'s Inbox. If you are done, run `lineclear ready` (or `lineclear done` when nothing changed). If you wait for the owner (only a login code, money beyond the budget, or something that leaves the machine), run `lineclear wait owner --kind login|money|outward "<what you need>"`. Otherwise carry on with your task.';

/** The nudge for a reply that promised its next action. */
export const PROMISE_NUDGE =
  'Your turn ended with a promise of the next action ("I\'ll keep calling", "I\'ll check again") and no declared wait. Run that action now. If it cannot run yet, declare the wait with `lineclear wait task|until|owner ...` and end your turn.';

type Part = { type?: string; name?: string; text?: string; arguments?: { command?: unknown } };
type Message = { role?: string; content?: string | Part[] };

/** A command that ends a turn on purpose: a report, a close, a question or a declared wait. */
const ENDS_TURN = /\blineclear\s+(ready|done|ask|wait)\b/;

const parts = (m: Message): Part[] => (Array.isArray(m.content) ? m.content : []);

/** What a turn did last: the messages after the latest user message are the turn. */
const turnOf = (messages: Message[]): Message[] => messages.slice(messages.map((m) => m.role).lastIndexOf("user") + 1);

/** The nudge a turn's end earns, or undefined when it ended on purpose (it ran ready, done, ask or wait). */
export function quietNudge(messages: Message[]): string | undefined {
  const turn = turnOf(messages);
  const ran = turn
    .flatMap(parts)
    .some((p) => p.type === "toolCall" && p.name === "bash" && typeof p.arguments?.command === "string" && ENDS_TURN.test(p.arguments.command));
  if (ran) return undefined;
  const last = [...turn].reverse().find((m) => m.role === "assistant");
  const text = last
    ? parts(last)
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("\n")
    : "";
  return promisesNext(text) ? PROMISE_NUDGE : IDLE_NUDGE;
}
