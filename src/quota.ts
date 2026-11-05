import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir, readJson } from "../pi/config.ts";
import { type Limits, type Window, callsOf, LIMITED_STREAK } from "../pi/extension.ts";
import { clearFull, markFull, providerOf, readAccounts } from "./full.ts";
import { piDir } from "./paths.ts";

// Codex and OpenCode Go send no limit headers, so their limits are asked from their usage endpoints with the login
// pi stores. The shapes follow @narumitw/pi-usage 0.69.0 (MIT, src/providers/codex.ts and opencode-zen.ts).
const CODEX_URL = "https://chatgpt.com/backend-api/wham/usage";
const GO_URL = "https://opencode.ai/zen/go/v1/usage";
const TIMEOUT_MS = 10_000;
/** A reading younger than this is not asked for again: the loop ticks far more often than a limit moves. */
const FRESH_MS = 5 * 60_000;
/** A window at least this long counts as the week. */
const WEEK_MIN_SECONDS = 6 * 86_400;
const SESSION_MS = 5 * 3_600_000;

type Windows = Pick<Limits, "session" | "week">;
type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const percent = (used: number) => Math.round(Math.min(100, Math.max(0, used)) * 10) / 10;

/** Codex's two windows: the one at least six days long is the week, the other the session. */
export function codexWindows(payload: unknown): Windows {
  const rate = obj(obj(payload)?.rate_limit);
  const found: Windows = {};
  for (const [key, fallback] of [
    ["primary_window", "session"],
    ["secondary_window", "week"],
  ] as const) {
    const w = obj(rate?.[key]);
    const used = num(w?.used_percent);
    if (used === undefined) continue;
    const seconds = num(w?.limit_window_seconds);
    const reset = num(w?.reset_at);
    const kind = seconds === undefined ? fallback : seconds >= WEEK_MIN_SECONDS ? "week" : "session";
    found[kind] = { percent: percent(used), ...(reset ? { resetAt: new Date(reset * 1000).toISOString() } : {}) };
  }
  return found;
}

function goWindow(w: Record<string, unknown>, used: number): Window {
  const reset = typeof w.resetsAt === "string" ? Date.parse(w.resetsAt) : Number.NaN;
  return { percent: w.status === "rate-limited" ? 100 : percent(used), ...(Number.isFinite(reset) ? { resetAt: new Date(reset).toISOString() } : {}) };
}

/**
 * Go's rolling window is its session; its weekly window is the week. A rate-limited window is full. A full monthly
 * window is no pace window, but it blocks the account like a full week until the month resets, so it takes the week's place.
 */
export function goWindows(payload: unknown): Windows {
  const usage = obj(obj(payload)?.usage);
  const found: Windows = {};
  for (const [key, kind] of [
    ["rolling", "session"],
    ["weekly", "week"],
  ] as const) {
    const w = obj(usage?.[key]);
    if (w?.status !== "ok" && w?.status !== "rate-limited") continue;
    const used = num(w.percent);
    if (used === undefined || used < 0) continue;
    found[kind] = goWindow(w, used);
  }
  const month = obj(usage?.monthly);
  const monthUsed = num(month?.percent);
  if (month && monthUsed !== undefined && (month.status === "rate-limited" || monthUsed >= 100)) found.week = goWindow(month, monthUsed);
  return found;
}

/** The headers pi's stored login gives each account, or undefined when it holds none. */
function login(auth: Record<string, unknown>, account: string): Record<string, string> | undefined {
  const a = obj(auth[account]);
  if (account === "openai-codex") {
    const { access, accountId } = a ?? {};
    return typeof access === "string" && typeof accountId === "string" ? { Authorization: `Bearer ${access}`, "ChatGPT-Account-Id": accountId } : undefined;
  }
  return typeof a?.key === "string" ? { Authorization: `Bearer ${a.key}` } : undefined;
}

type Context = { env: NodeJS.ProcessEnv; now: number; get: Fetch };

/** A reader of one account's quota: how full its windows are (percent of the limit used), or `unknown`. */
export interface QuotaAdapter {
  account: string;
  /** Asked over the network by `refreshQuota`, at most every five minutes; the others read what pi noted. */
  poll?: boolean;
  /** Throws when the account cannot be read now. */
  read(account: string, ctx: Context): Promise<Windows | "unknown">;
}

const adapters = new Map<string, QuotaAdapter>();
export const registerAdapter = (adapter: QuotaAdapter): void => void adapters.set(adapter.account, adapter);

async function askEndpoint(url: string, account: string, ctx: Context, read: (payload: unknown) => Windows): Promise<Windows | "unknown"> {
  const headers = login(readJson(join(piDir(ctx.env), "auth.json")) ?? {}, account);
  if (!headers) return "unknown";
  const res = await ctx.get(url, { headers: { ...headers, "User-Agent": "lineclear" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${account} answered not ok`);
  const found = read(await res.json());
  return found.session || found.week ? found : "unknown";
}

registerAdapter({
  account: "anthropic",
  read: async (account, { env }) => {
    const noted = readJson(join(configDir(env), "limits.json"))?.[account] as Limits | undefined;
    return noted && (noted.session || noted.week)
      ? { ...(noted.session ? { session: noted.session } : {}), ...(noted.week ? { week: noted.week } : {}) }
      : "unknown";
  },
});
registerAdapter({ account: "openai-codex", poll: true, read: (account, ctx) => askEndpoint(CODEX_URL, account, ctx, codexWindows) });
registerAdapter({ account: "opencode-go", poll: true, read: (account, ctx) => askEndpoint(GO_URL, account, ctx, goWindows) });

/**
 * The reader of an account with no adapter: it reports `unknown` and never a limit. What it knows are the account's own
 * calls and 429 answers since its last reset, counted by pi's extension.
 */
export const unknownAdapter = {
  read: async (): Promise<"unknown"> => "unknown",
  counts: (account: string, env = process.env, now = Date.now()) => {
    const { calls, limited } = callsOf(account, env, new Date(now));
    return { calls, limited };
  },
};

/** When each account was last asked, by config folder: a failing login is not asked again every tick either. */
const asked = new Map<string, number>();

/** Notes one account's windows in `limits.json`, read afresh so pi's extension writing Claude's meanwhile is kept. */
function note(account: string, found: Windows, env: NodeJS.ProcessEnv, now: number): void {
  const file = join(configDir(env), "limits.json");
  const all: Record<string, Limits> = readJson(file) ?? {};
  all[account] = { ...found, at: new Date(now).toISOString() };
  mkdirSync(configDir(env), { recursive: true });
  writeAtomic(file, `${JSON.stringify(all, null, 2)}\n`);
}

/**
 * Asks each polled adapter for its limits, notes them in `limits.json` as Claude's are, and marks the account out until
 * the reset when a window is full or back when none is. An account whose adapter fails is left as it was. Each is asked
 * at most every five minutes. An account that reads `unknown` is never open-ended: three 429 answers in a row hold it
 * until its reset.
 */
export async function refreshQuota(env = process.env, now = Date.now(), get: Fetch = fetch as unknown as Fetch): Promise<void> {
  const ctx = { env, now, get };
  for (const adapter of adapters.values()) {
    const { account } = adapter;
    const key = `${configDir(env)}:${account}`;
    if (!adapter.poll || now - (asked.get(key) ?? 0) < FRESH_MS) continue;
    asked.set(key, now);
    let found: Windows | "unknown";
    try {
      found = await adapter.read(account, ctx);
    } catch {
      continue;
    }
    if (found === "unknown") continue;
    note(account, found, env, now);
    const window = (["week", "session"] as const).find((w) => (found[w]?.percent ?? 0) >= 100);
    // a full window with no reset time is held as long as a Claude session would be, then asked again
    if (window) markFull(account, new Date(found[window]?.resetAt ?? now + SESSION_MS), window, env);
    else clearFull(account, env);
  }
  await holdUnknown(ctx);
}

async function holdUnknown({ env, now, get }: Context): Promise<void> {
  const counted = Object.keys(readJson(join(configDir(env), "calls.json")) ?? {});
  for (const account of counted) {
    const adapter = adapters.get(account);
    if (adapter?.poll) continue;
    if (adapter && (await adapter.read(account, { env, now, get }).catch(() => "unknown")) !== "unknown") continue;
    const { streak, resetAt } = callsOf(account, env, new Date(now));
    if (streak >= LIMITED_STREAK && resetAt) markFull(account, new Date(resetAt), "session", env);
  }
}

const fullUntil = (account: string, env: NodeJS.ProcessEnv, now: Date): string | undefined => {
  const a = readAccounts(env)[account];
  return a?.out && !(a.resetAt !== undefined && new Date(a.resetAt) <= now) ? (a.resetAt ?? "its reset") : undefined;
};

/** The worker a step starts on, its account and why: the full accounts of the list before it are named with their reset. */
export function startAccountNote(models: string[], worker: string, env = process.env, now = new Date()): string {
  const account = providerOf(worker);
  const passed = [...new Set(models.slice(0, models.indexOf(worker)).map(providerOf))].filter((p) => p !== account);
  const full = passed.flatMap((p) => {
    const until = fullUntil(p, env, now);
    return until === undefined ? [] : [`${p} is full until ${until}`];
  });
  return `worker ${worker} (account ${account}${full.length > 0 ? `: ${full.join(", ")}` : ""})`;
}

/** Why no worker model can start a step now: every account of the list is full until a reset, or none has room. */
export function noWorkerNote(models: string[], env = process.env, now = new Date()): string {
  const resets = [...new Set(models.map(providerOf))].map((p) => ({ p, until: fullUntil(p, env, now) }));
  if (resets.some((r) => r.until === undefined)) return "no worker model has room, or its paid key is not allowed yet";
  const first = resets.map((r) => r.until as string).sort()[0];
  return `every account of the list is full (${resets.map((r) => r.p).join(", ")}): the start waits for the first reset, ${first}`;
}
