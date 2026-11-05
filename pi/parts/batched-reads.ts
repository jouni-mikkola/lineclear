// Part: after several turns in a row that each made one read, add one line to the result of the next read, so the agent
// batches reads that do not depend on each other into one turn. Every turn sends the whole context again.
type Pi = { on: (event: string, handler: (event: any, ctx: any) => unknown) => void };

/** Turns in a row with one read each, before the hint. */
export const SINGLE_READS = 3;

export const HINT = "Hint: reads that do not depend on each other go in one turn, as several read calls in one message.";

export default function batchedReads(pi: Pi): void {
  let calls: string[] = [];
  let streak = 0;
  pi.on("turn_start", () => {
    calls = [];
    return undefined;
  });
  pi.on("tool_call", (event) => {
    calls.push(String(event.toolName));
    return undefined;
  });
  pi.on("turn_end", () => {
    streak = calls.length === 1 && calls[0] === "read" ? streak + 1 : 0;
    return undefined;
  });
  pi.on("tool_result", (event) => {
    if (event.toolName !== "read" || event.isError || streak < SINGLE_READS) return undefined;
    streak = 0; // one line, then count again
    return { content: [...(event.content ?? []), { type: "text", text: HINT }] };
  });
}
