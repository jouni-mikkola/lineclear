// Lineclear's pi extension. It keeps an agent inside its task: no push, and no secret or login file that is not its own.
// It also loads the token pack (pi/pack.ts), notes how full each account's limits are, for Home's Usage card, and gives
// Lineclear's agents the kit (kit/): its rules in the system prompt and its skills, so no agent needs personal files.
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { writeAtomic } from "./atomic.ts";
import { configDir, readJson } from "./config.ts";
import pack from "./pack.ts";
import { toolRun } from "./heavy-tool.ts";
import { quietNudge } from "./nudge.ts";

type Env = Record<string, string | undefined>;

const PUSH = /(^|[\s;&|(`])git(\s+(-[Cc]\s+\S+|--[\w-]+(=\S+)?|-[\w]+))*\s+push(\s|$|[;&|)`])/;
const word = (name: string) => new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`);

/** Login files an agent never needs, as patterns on a command or a path. */
const LOGIN_FILES: [RegExp, string][] = [
  [/(^|[\s/'"=:~])\.ssh(\/|\s|$|['"])/, "~/.ssh holds your SSH keys"],
  [/\.git-credentials/, "git's saved logins are yours alone"],
  [/\.config\/gh(\/|\s|$|['"])/, "gh's login is yours alone"],
  [/\.config\/git\/credentials/, "git's saved logins are yours alone"],
];

type Deny = { names: string[] };

/** What a task in this folder may not see, asked of the lineclear command so there is one source of truth. */
function deny(cwd: string, env: Env): Deny {
  try {
    const text = execFileSync(env.LINECLEAR_BIN ?? "lineclear", ["secrets", "deny"], {
      cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    return JSON.parse(text) as Deny;
  } catch {
    // no lineclear to ask: the rules that need no list (push, login files, owner.env by name) still hold
    return { names: [] };
  }
}

// Loose on purpose: a quote, a path or a wrapper (sh -c, bin/lineclear, bun src/cli.ts) must not get past them.
const INBOX_ANSWER = /\binbox\s+(answer|undo)\b|\binbox\/\d+(\.json)?\b/;
const MERGE = /\blineclear\s+merge\b|\bgit\b[^;&|\n]*\s(merge|pull)\b|\bgh\s+pr\s+merge\b/;

/** True in the Dispatcher: its role is set, or it runs in its folder (<config>/dispatcher). */
export function inDispatcher(cwd: string, env: Env): boolean {
  if (env.LINECLEAR_ROLE === "dispatcher") return true;
  const dir = join(configDir(env), "dispatcher");
  return cwd === dir || cwd.startsWith(`${dir}/`);
}

/** Why a command is refused, as one line, or undefined when it may run. */
export function refusal(command: string, cwd: string, env: Env = process.env): string | undefined {
  if (INBOX_ANSWER.test(command)) return "Refused: no agent answers the Inbox or undoes a plan. Only the owner does.";
  if (inDispatcher(cwd, env)) {
    if (MERGE.test(command)) return "Refused: the Dispatcher never merges. A project's task merges itself, or the owner approves in the Inbox.";
  }
  if (PUSH.test(command)) return "Refused: git push. Agents never push, ask the server to merge (lineclear merge <task>).";
  const bare = command.replace(/['"\\]/g, "");
  if (/owner\.e|secrets\.env|vault[.*?[]|LINECLEAR_CONFIG/.test(bare))
    return "Refused: owner.env, the vault and the projects' secrets.env files are not for an agent. It gets its own through 'eval \"$(lineclear secrets env)\"'.";
  if (/lineclear\s+secrets\s+(set|list|deny)\b/.test(command))
    return "Refused: an agent may only run 'lineclear secrets env'. Setting and listing secrets is yours.";
  // a restored copy holds the vault and the owner-only secrets, in a folder no other refusal knows
  if (/\bbackup\s+restore\b/.test(bare)) return "Refused: restoring a backup is yours: it holds every secret.";
  for (const [pattern, why] of LOGIN_FILES) if (pattern.test(command)) return `Refused: ${why}, and no agent needs it.`;
  const hit = deny(cwd, env).names.find((n) => word(n).test(command));
  if (hit !== undefined) return `Refused: ${hit} is a secret this task may not see (owner-only or another project's).`;
  return undefined;
}

/** The project's heavy commands and its check, asked of the lineclear command, which reads the project's settings. */
function heavy(cwd: string, env: Env): { heavy: string[]; check?: string } {
  try {
    const text = execFileSync(env.LINECLEAR_BIN ?? "lineclear", ["slot", "--list"], {
      cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    const j = JSON.parse(text) as { heavy?: string[]; check?: string };
    return { heavy: j.heavy ?? [], check: j.check };
  } catch {
    return { heavy: [] };
  }
}

const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A heavy tool run straight, in any project: a browser suite, a build, a linter of the whole tree, or a whole test run.
 * One test file, some tests by name, one linted file or a watch is a task's own quick run and stays free.
 */
export const heavyTool = (command: string, cwd?: string): boolean => toolRun(command, cwd) === "heavy";

/**
 * The command to run instead. A line that holds the project's check runs whole through `lineclear check`, so it waits
 * its turn: one full check at a time per machine. A line that holds another heavy command (the project's, or a heavy tool
 * run straight) runs through `lineclear slot`.
 */
export function inSlot(command: string, cwd: string, env: Env = process.env): string | undefined {
  const trimmed = command.trim();
  if (/(^|[\s;&|(])(\S*\/)?lineclear\s+(slot|check)\b/.test(trimmed)) return undefined;
  const has = (h: string) => new RegExp(`(^|[\\s;&|(])${escapeRegex(h)}($|[\\s;&|)])`).test(trimmed);
  const p = heavy(cwd, env);
  const bin = env.LINECLEAR_BIN ?? "lineclear";
  if (p.check !== undefined && has(p.check)) return `${bin} check ${quote(trimmed)}`;
  return p.heavy.some(has) || heavyTool(trimmed, cwd) ? `${bin} slot ${quote(trimmed)}` : undefined;
}

/** The same rule for a file an agent reads or writes. */
export function pathRefusal(path: string, cwd: string, env: Env = process.env): string | undefined {
  const full = path.startsWith("~") ? join(env.HOME ?? homedir(), path.slice(1)) : path;
  return refusal(`cat ${full}`, cwd, env);
}

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
  pi.on("tool_call", (event, ctx) => {
    const cwd: string = ctx?.cwd ?? process.cwd();
    const input = event.input ?? {};
    let why: string | undefined;
    if (event.toolName === "bash" && typeof input.command === "string") why = refusal(input.command, cwd);
    else if (typeof input.path === "string") why = pathRefusal(input.path, cwd);
    if (why !== undefined) return { block: true, reason: why };
    if (event.toolName === "bash" && typeof input.command === "string") {
      const wrapped = inSlot(input.command, cwd);
      if (wrapped !== undefined) input.command = wrapped;
    }
    return undefined;
  });
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
  await pack(pi);
}
