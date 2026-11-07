// A chat (a coordinator or the Dispatcher) is compacted at a set size, so a long session never pays to send its whole
// history on every call. pi compacts only near the model's window (800 k reserve on a 1 M one), far past this.
import { inDispatcher } from "./fresh-dispatcher.ts";

type Raw = any;
type Env = Record<string, string | undefined>;
type Pi = { on: (event: string, handler: (event: Raw, ctx: Raw) => unknown) => void };

/** The context size, in tokens, at which a coordinator's session is compacted. */
export const COORDINATOR_LIMIT = 60_000;
/** The same for the Dispatcher, whose requests are short. */
export const DISPATCHER_LIMIT = 60_000;

/** The compaction size of this agent's chat, or undefined when it is no chat: a task's agent or reviewer, or a hand-run pi. */
function chatLimit(env: Env, cwd: string): number | undefined {
  if (inDispatcher(cwd, env)) return DISPATCHER_LIMIT;
  const chat = env.LINECLEAR_CHAT;
  return chat && !chat.includes("/") ? COORDINATOR_LIMIT : undefined;
}

export default function compactChats(pi: Pi, env: Env = process.env): void {
  const limit = chatLimit(env, process.cwd());
  if (limit === undefined) return;
  pi.on("agent_end", (_event, ctx) => {
    try {
      const tokens = ctx?.getContextUsage?.()?.tokens;
      if (typeof tokens === "number" && tokens > limit) ctx.compact();
    } catch {
      // compacting must never get in the way of a reply
    }
  });
}
