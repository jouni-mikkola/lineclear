// Lineclear's pi extension. It gives Lineclear's agents the kit (kit/): its rules in the system prompt and its skills, so no agent needs personal files.
import { delimiter, dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { quietNudge } from "./nudge.ts";
import freshDispatcher from "./fresh-dispatcher.ts";
import compactChats from "./compact-chats.ts";
import accountFallback from "./account-fallback.ts";

type Env = Record<string, string | undefined>;

// pi loads extensions in Node, which has no import.meta.dir
const KIT = join(dirname(realpathSync(fileURLToPath(import.meta.url))), "..", "kit");

/** True in an agent Lineclear or its board started: a task's chat, a task id or a role is set. */
export const lineclearAgent = (env: Env) => !!(env.LINECLEAR_CHAT || env.LINECLEAR_TASK || env.LINECLEAR_ROLE);

/** The kit's skills, and the skill playwright-cli ships when it is installed (its own, so it fits its version). */
export function kitSkills(env: Env = process.env): string[] {
  const paths = [join(KIT, "skills")];
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    const bin = join(dir, "playwright-cli");
    if (!dir || !existsSync(bin)) continue;
    // the command links into its package: <package>/playwright-cli.js, with <package>/skills beside it
    const skills = join(dirname(realpathSync(bin)), "skills");
    if (existsSync(skills)) paths.push(skills);
    break;
  }
  return paths;
}

/** Nudges in a row a task agent gets at once before its quiet turn is left to the stall ladder. */
export const NUDGES_IN_A_ROW = 2;

/** True in a task's agent: its chat is `<task>/Agent`. The Dispatcher, reviewers and a hand-run pi are never nudged. */
export const taskAgent = (env: Env) => /\/Agent$/.test(env.LINECLEAR_CHAT ?? "");

/** Beats a little under the 5 minutes the server may go without a sign of life. */
export const BEAT_MS = 4 * 60_000;

/** The task id of a task agent: its chat is `<task>/Agent`. */
const taskOf = (env: Env) => /^(.+)\/Agent$/.exec(env.LINECLEAR_CHAT ?? "")?.[1];

type Pi = {
  on: (event: string, handler: (event: any, ctx: any) => unknown) => void;
  appendEntry?: (type: string, data?: unknown) => void;
  sendUserMessage?: (text: string, options?: { deliverAs?: string }) => void;
};

/** Answers a task agent's quiet turn at once, twice in a row; a message from anyone else starts the count again. */
export function nudgeQuietTurns(pi: Pi, env: Env = process.env): void {
  if (!taskAgent(env)) return;
  let row = 0;
  let ours = false;
  pi.on("before_agent_start", () => {
    if (!ours) row = 0;
    ours = false;
  });
  pi.on("agent_end", (event) => {
    const nudge = quietNudge(event?.messages ?? []);
    if (nudge === undefined) {
      row = 0;
      return;
    }
    if (row >= NUDGES_IN_A_ROW || !pi.sendUserMessage) return;
    row++;
    ours = true;
    pi.sendUserMessage(nudge, { deliverAs: "followUp" });
  });
}

/**
 * While a tool call runs, tells the server every BEAT_MS that the agent is alive: pi writes its log only when a call
 * ends, so a long check looks silent. The beats stop when the last running call ends, or the agent's turn does.
 */
export function beatDuringCalls(
  pi: Pi,
  env: Env = process.env,
  beat: (task: string) => void = (task) => void execFile(env.LINECLEAR_BIN ?? "lineclear", ["alive", task], { env: env as NodeJS.ProcessEnv }, () => undefined),
  every = BEAT_MS,
): void {
  const task = taskOf(env);
  if (!task) return;
  const running = new Set<string>();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  pi.on("tool_call", (event) => {
    running.add(String(event?.toolCallId ?? running.size));
    timer ??= setInterval(() => beat(task), every);
    timer.unref?.();
    return undefined;
  });
  pi.on("tool_result", (event) => {
    running.delete(String(event?.toolCallId ?? ""));
    if (!running.size) stop();
  });
  pi.on("agent_end", () => {
    running.clear();
    stop();
  });
}

/** A tool result longer than this many lines is cut before the next turn: every later turn re-reads it from the cache. */
export const MAX_RESULT_LINES = 100;
/** Lines kept from the start and from the end of a cut tool result. */
const KEPT_LINES = 40;

type Block = { type?: string; text?: string };

/** The result with its middle cut when it has more than MAX_RESULT_LINES lines; the same block when it is short. */
export function cutLongResult(block: Block): Block {
  if (block?.type !== "text" || typeof block.text !== "string") return block;
  const lines = block.text.split("\n");
  if (lines.length <= MAX_RESULT_LINES) return block;
  const cut = lines.length - 2 * KEPT_LINES;
  const note = `[${cut} lines cut to save tokens: read the file or rerun with grep or tail for the part you need]`;
  return { ...block, text: [...lines.slice(0, KEPT_LINES), note, ...lines.slice(-KEPT_LINES)].join("\n") };
}

/** Cuts the long tool results in a task agent's session before each call, so they are not re-sent on every later turn. */
export function cutLongResults(pi: Pi, env: Env = process.env): void {
  if (!lineclearAgent(env)) return;
  pi.on("context", (event) => {
    try {
      if (!Array.isArray(event?.messages)) return undefined;
      let changed = false;
      const messages = event.messages.map((m: any) => {
        if (m?.role !== "toolResult" || !Array.isArray(m.content)) return m;
        const content = m.content.map(cutLongResult);
        if (content.every((b: Block, i: number) => b === m.content[i])) return m;
        changed = true;
        return { ...m, content };
      });
      return changed ? { messages } : undefined;
    } catch {
      return undefined; // cutting must never get in the way of a call
    }
  });
}

export default async function lineclearExtension(pi: Pi): Promise<void> {
  nudgeQuietTurns(pi);
  beatDuringCalls(pi);
  cutLongResults(pi);
  freshDispatcher(pi);
  compactChats(pi);
  accountFallback(pi);
  pi.on("resources_discover", () => (lineclearAgent(process.env) ? { skillPaths: kitSkills() } : undefined));
  pi.on("before_agent_start", (event) => {
    const sections = event?.systemPromptOptions?.sections;
    if (!lineclearAgent(process.env) || !sections) return;
    try {
      sections.lineclear_rules = readFileSync(join(KIT, "rules.md"), "utf8");
    } catch {
      // a copy without kit/ still runs; the brief carries the task's own rules
    }
  });
}
