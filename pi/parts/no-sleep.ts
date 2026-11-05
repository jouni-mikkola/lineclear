// Part: refuse a bash call that starts with a long `sleep`, and name a command that blocks until done instead. Waiting
// with sleep and a look at a log sends the whole context again on every look.
type Pi = { on: (event: string, handler: (event: any, ctx: any) => unknown) => void };

/** A sleep of this many seconds or more is refused; a shorter one is allowed. */
export const LONG_SLEEP = 10;

const UNIT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** The seconds a command that starts with `sleep` waits, or undefined when it does not start with one. */
export function sleepSeconds(command: string): number | undefined {
  const m = command
    .trimStart()
    .replace(/^\S*lineclear\s+slot\s+'/, "")
    .match(/^sleep((?:\s+[0-9.]+[smhd]?)+)(?=\s|;|&|\||$)/);
  if (!m) return undefined;
  let total = 0;
  for (const arg of m[1]!.trim().split(/\s+/)) {
    const n = parseFloat(arg);
    if (Number.isNaN(n)) return undefined;
    total += n * (UNIT[arg.slice(-1)] ?? 1);
  }
  return total;
}

export function refusal(command: string): string | undefined {
  const s = sleepSeconds(command);
  if (s === undefined || s < LONG_SLEEP) return undefined;
  return "Refused: a long sleep. Wait inside one command that blocks until done: run the command itself in the foreground, or `until grep -q DONE log; do sleep 5; done`. Give a long command a timeout.";
}

export default function noSleep(pi: Pi): void {
  pi.on("tool_call", (event) => {
    const command = event.input?.command;
    if (event.toolName !== "bash" || typeof command !== "string") return undefined;
    const why = refusal(command);
    return why === undefined ? undefined : { block: true, reason: why };
  });
}
