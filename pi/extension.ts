// Lineclear's pi extension. It notes how full each account's limits are, for Home's Usage card, and gives
// Lineclear's agents the kit (kit/): its rules in the system prompt and its skills, so no agent needs personal files.
import { delimiter, dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { writeAtomic } from "./atomic.ts";
import { configDir, readJson } from "./config.ts";
import { quietNudge } from "./nudge.ts";

type Env = Record<string, string | undefined>;

/** How full one limit window is: used in percent and when it starts again (ISO time). */
export type Window = { percent: number; resetAt?: string };
export type Limits = { session?: Window; week?: Window; at: string };

/**
 * The limits a response reports, from Anthropic's unified rate limit headers (`anthropic-ratelimit-unified-5h-*` for
 * the session, `-7d-*` for the week: utilization 0 to 1, reset in Unix seconds), which pi's Claude providers pass on.
 */
export function limitsOf(headers: Record<string, string>): Omit<Limits, "at"> | undefined {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const window = (name: string): Window | undefined => {
    const raw = h[`anthropic-ratelimit-unified-${name}-utilization`];
    const used = Number(raw);
    if (raw === undefined || raw === "" || !Number.isFinite(used)) return undefined;
    const reset = Number(h[`anthropic-ratelimit-unified-${name}-reset`]);
    return { percent: Math.round(Math.min(1, Math.max(0, used)) * 1000) / 10, ...(reset > 0 ? { resetAt: new Date(reset * 1000).toISOString() } : {}) };
  };
  const session = window("5h");
  const week = window("7d");
  return session || week ? { ...(session ? { session } : {}), ...(week ? { week } : {}) } : undefined;
}

/** Keeps an account's latest limits in `<config>/limits.json`, which Home reads. Written only when they change. */
export function recordLimits(account: string, headers: Record<string, string>, env: Env = process.env, now = new Date()): void {
  const found = limitsOf(headers);
  if (!found) return;
  const file = join(configDir(env), "limits.json");
  const all: Record<string, Limits> = readJson(file) ?? {};
  const { at: _, ...old } = all[account] ?? { at: "" };
  if (JSON.stringify(old) === JSON.stringify(found)) return;
  all[account] = { ...found, at: now.toISOString() };
  mkdirSync(configDir(env), { recursive: true });
  writeAtomic(file, `${JSON.stringify(all, null, 2)}\n`);
}

/** An account's own calls since its last reset: all, those answered 429, and the 429s in a row. */
export type Calls = { calls: number; limited: number; streak: number; since: string; resetAt?: string };
/** Three 429s in a row hold an account with no quota reader until this long after the third. */
export const LIMITED_STREAK = 3;
const HOLD_MS = 5 * 3_600_000;

/** The counts of an account, or none counted when its reset has passed. */
export function callsOf(account: string, env: Env = process.env, now = new Date()): Calls {
  const old: Calls | undefined = readJson(join(configDir(env), "calls.json"))?.[account];
  if (old && !(old.resetAt && Date.parse(old.resetAt) <= now.getTime())) return old;
  return { calls: 0, limited: 0, streak: 0, since: old?.resetAt ?? now.toISOString() };
}

/** Counts one answer of an account's provider; the streak of 429s that reaches three sets the reset that ends the hold. */
export function recordCall(account: string, status: number, env: Env = process.env, now = new Date()): void {
  const file = join(configDir(env), "calls.json");
  const all: Record<string, Calls> = readJson(file) ?? {};
  const old = callsOf(account, env, now);
  const limited = status === 429;
  const streak = limited ? old.streak + 1 : 0;
  const resetAt = old.resetAt ?? (streak >= LIMITED_STREAK ? new Date(now.getTime() + HOLD_MS).toISOString() : undefined);
  all[account] = { calls: old.calls + 1, limited: old.limited + (limited ? 1 : 0), streak, since: old.since, ...(resetAt ? { resetAt } : {}) };
  mkdirSync(configDir(env), { recursive: true });
  writeAtomic(file, `${JSON.stringify(all, null, 2)}\n`);
}

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

export default async function lineclearExtension(pi: Pi): Promise<void> {
  nudgeQuietTurns(pi);
  beatDuringCalls(pi);
  pi.on("after_provider_response", (event, ctx) => {
    const account = ctx?.model?.provider;
    if (typeof account !== "string" || !event?.headers) return;
    try {
      recordLimits(account, event.headers);
      if (typeof event.status === "number") recordCall(account, event.status);
    } catch {
      // a limits file that cannot be written never stops the agent
    }
  });
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
