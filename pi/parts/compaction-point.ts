// Compaction at the point of the session's role (see rolePoint in pi/compaction.ts). pi has one reserve per model, not per
// role, so this compacts a role below it: when a turn that goes on ends past the point, it compacts and tells the agent
// to carry on.
import { rolePoint } from "../compaction.ts";

type Ctx = {
  getContextUsage?(): { tokens: number | null } | undefined;
  compact(options: { onComplete: () => void; onError: () => void }): void;
};
type Pi = {
  on(event: "turn_end", handler: (event: { toolResults?: unknown[] }, ctx: Ctx) => unknown): void;
  sendUserMessage?(text: string): void;
};

export const CARRY_ON = "[lineclear] The context was compacted. Carry on with the task from the summary.";

export default function compactionPoint(pi: Pi, env = process.env): void {
  const point = rolePoint(env);
  if (point === undefined) return;
  let busy = false;
  pi.on("turn_end", (ev, ctx) => {
    try {
      if (busy || !(Array.isArray(ev?.toolResults) && ev.toolResults.length > 0)) return undefined;
      const usage = ctx?.getContextUsage?.();
      if (!usage || typeof usage.tokens !== "number" || usage.tokens < point) return undefined;
      busy = true;
      ctx.compact({
        onComplete: () => {
          busy = false;
          pi.sendUserMessage?.(CARRY_ON);
        },
        onError: () => {
          busy = false;
        },
      });
    } catch {
      busy = false; // compacting must never get in the way of a turn
    }
    return undefined;
  });
}
