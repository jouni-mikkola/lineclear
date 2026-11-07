// Lineclear's pi extension. It gives Lineclear's agents the kit (kit/): its rules in the system prompt and its skills, so no agent needs personal files.
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, realpathSync } from "node:fs";
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

/** True in a task's agent: its chat is `<task>/Agent`. The Dispatcher, reviewers and a hand-run pi are never nudged. */
export const taskAgent = (env: Env) => /\/Agent$/.test(env.LINECLEAR_CHAT ?? "");

type Pi = {
  on: (event: string, handler: (event: any, ctx: any) => unknown) => void;
};

/** A tool result longer than this many lines or characters is cut once the model has read it. */
export const MAX_RESULT_LINES = 100;
const MAX_RESULT_CHARS = 8000;
/** Lines kept from the start and from the end of a cut tool result. */
const KEPT_LINES = 40;
const KEPT_CHARS = 3000;

type Block = { type?: string; text?: string };
type Message = { role?: string; content?: unknown };

/** The result with its middle cut when it is long; the same block when it is short. */
export function cutLongResult(block: Block): Block {
  if (block?.type !== "text" || typeof block.text !== "string") return block;
  const text = block.text;
  const lines = text.split("\n");
  const note = (what: string) => `[${what} cut to save tokens: rerun with offset, grep or tail for the part you need]`;
  if (lines.length > MAX_RESULT_LINES) {
    const cut = lines.length - 2 * KEPT_LINES;
    return { ...block, text: [...lines.slice(0, KEPT_LINES), note(`${cut} lines`), ...lines.slice(-KEPT_LINES)].join("\n") };
  }
  if (text.length <= MAX_RESULT_CHARS) return block;
  const cut = text.length - 2 * KEPT_CHARS;
  return { ...block, text: `${text.slice(0, KEPT_CHARS)}\n${note(`${cut} characters`)}\n${text.slice(-KEPT_CHARS)}` };
}

/**
 * Cuts the long tool results a task agent has already read, before each call: the model sees a result whole once, and
 * the cache does not re-send it on every later turn.
 */
export function cutLongResults(pi: Pi, env: Env = process.env): void {
  pi.on("context", (event) => {
    try {
      if (!taskAgent(env) || !Array.isArray(event?.messages)) return undefined;
      const messages: Message[] = event.messages;
      const seen = messages.findLastIndex((m) => m?.role === "assistant");
      let changed = false;
      const cut = messages.map((m, at) => {
        if (at > seen || m?.role !== "toolResult" || !Array.isArray(m.content)) return m;
        const content = (m.content as Block[]).map(cutLongResult);
        if (content.every((b, i) => b === (m.content as Block[])[i])) return m;
        changed = true;
        return { ...m, content };
      });
      return changed ? { messages: cut } : undefined;
    } catch {
      return undefined; // cutting must never get in the way of a call
    }
  });
}

export default async function lineclearExtension(pi: Pi): Promise<void> {
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
