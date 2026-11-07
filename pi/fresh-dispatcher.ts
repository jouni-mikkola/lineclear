// The Dispatcher answers each request from the request alone. Before every call its session is cut
// to the owner's latest message and what the Dispatcher did since, so a busy day does not carry every earlier request on
// every call. It reads the board from its tools, never from memory (templates/dispatcher.md), so nothing is lost. A card
// answer or a reply also keeps the request before it.
import { homedir } from "node:os";
import { join } from "node:path";

type Raw = any;
type Env = Record<string, string | undefined>;
type Pi = { on: (event: string, handler: (event: Raw, ctx: Raw) => unknown) => void };

const ANSWER = /^\s*<(answer|reply)\b/;
const isUser = (m: Raw) => m?.role === "user";
const textOf = (m: Raw): string => (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? String(m.content[0]?.text ?? "") : "");

/** True in the Dispatcher: its role is set, or it runs in its folder (<config>/dispatcher). */
function inDispatcher(cwd: string, env: Env): boolean {
  if (env.LINECLEAR_ROLE === "dispatcher") return true;
  const dir = join(env.LINECLEAR_CONFIG || join(env.HOME ?? homedir(), ".config", "lineclear"), "dispatcher");
  return cwd === dir || cwd.startsWith(`${dir}/`);
}

/** The messages from the latest request on; the same array when it already starts there. A card answer keeps the request it answers. */
export function sinceLastRequest(messages: Raw[]): Raw[] {
  let at = messages.findLastIndex(isUser);
  while (at > 0 && ANSWER.test(textOf(messages[at])) && messages.slice(0, at).some(isUser)) at = messages.slice(0, at).findLastIndex(isUser);
  return at <= 0 ? messages : messages.slice(at);
}

export default function freshDispatcher(pi: Pi, env = process.env): void {
  pi.on("context", (ev, ctx) => {
    try {
      if (!inDispatcher(ctx?.cwd ?? process.cwd(), env) || !Array.isArray(ev?.messages)) return undefined;
      const messages = sinceLastRequest(ev.messages);
      return messages === ev.messages ? undefined : { messages };
    } catch {
      return undefined; // cutting must never get in the way of a call
    }
  });
}
