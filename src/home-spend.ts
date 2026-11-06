import { mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { readJson } from "../pi/config.ts";
import type { Account } from "./full.ts";
import { GAUGE_WINDOW } from "./compaction-gauge.ts";
import { costOf, priceFinder, type Price } from "./measure.ts";
import { piHarness } from "./harness-pi.ts";
import { piDir } from "./paths.ts";
import { sessionUsage, type Usage } from "./session-text.ts";
import { DAY, HOUR_MS } from "./time.ts";

type Env = Record<string, string | undefined>;

interface Money {
  amount: number;
  currency: string;
}

/** One account's month. `paid` and `apiEquivalent` are missing when they are not reported, never 0. */
interface AccountMonth {
  account: string;
  kind: Account["kind"];
  paid?: Money;
  apiEquivalent?: number;
}

/**
 * The calendar month so far. `paid` adds what is known by currency: each set subscription price in full, and the real
 * spend of pay-as-you-go keys; `paidUnknown` is set when an account's cost is not reported. `apiEquivalent` is the
 * token-based spend at list prices, missing when no token could be priced.
 */
export interface MonthSpend {
  month: string;
  paid: Money[];
  paidUnknown: boolean;
  apiEquivalent?: number;
  accounts: AccountMonth[];
}

/** Spend and usage from pi's session files: what you see, and the accounts used in the last 24 hours. */
export interface PiSpend {
  /** The equivalent $ of each of the last 14 days, oldest first. */
  spend: { day: string; dollars: number }[];
  active: string[];
  /** The API-equivalent $ of this month per account; an account whose tokens had no price is missing. */
  monthly?: Record<string, number>;
  /** The accounts that had tokens this month, priced or not. */
  monthAccounts?: string[];
  /** The month `monthly` is of, such as "2026-10". */
  month?: string;
  /** Every token of the compaction card's window: input, output and cache. */
  tokens?: number;
}

const monthOf = (at: number) => new Date(at).toISOString().slice(0, 7);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The month so far from each account's API-equivalent $ and the accounts file. Unknown stays missing. */
export function monthSpend(pi: PiSpend, accounts: Record<string, Account>, now: number): MonthSpend | undefined {
  if (pi.monthly === undefined) return undefined;
  const month = monthOf(now);
  const current = pi.month === month;
  const monthly = current ? pi.monthly : {};
  const used = new Set(current ? (pi.monthAccounts ?? Object.keys(monthly)) : []);
  const names = [...new Set([...used, ...Object.keys(accounts)])].filter((a) => !accounts[a]?.retired).sort();
  const list = names.map((account): AccountMonth => {
    const a = accounts[account];
    const kind = a?.kind ?? "subscription";
    // an account with no tokens this month spent nothing; one whose tokens had no price is not reported
    const api = monthly[account] ?? (used.has(account) ? undefined : 0);
    let paid: Money | undefined;
    if (kind === "subscription") paid = a?.price !== undefined && a.currency ? { amount: a.price, currency: a.currency } : undefined;
    else if (kind === "free") paid = { amount: 0, currency: "USD" };
    else if (api !== undefined) paid = { amount: api, currency: "USD" };
    return { account, kind, ...(paid ? { paid: { ...paid, amount: round2(paid.amount) } } : {}), ...(api !== undefined ? { apiEquivalent: round2(api) } : {}) };
  });
  const sums = new Map<string, number>();
  for (const m of list) if (m.paid) sums.set(m.paid.currency, (sums.get(m.paid.currency) ?? 0) + m.paid.amount);
  const known = list.filter((m) => m.apiEquivalent !== undefined);
  return {
    month,
    paid: [...sums].filter(([, amount]) => amount > 0).map(([currency, amount]) => ({ amount: round2(amount), currency })),
    paidUnknown: list.some((m) => !m.paid),
    ...(known.length ? { apiEquivalent: round2(known.reduce((s, m) => s + (m.apiEquivalent ?? 0), 0)) } : {}),
    accounts: list,
  };
}

/** The $ of each of the last 14 days and the accounts used in the last day, from pi's session files. */
export function spendAndUsage(messages: { at: number; account: string; usage: Usage }[], priceOf: (u: Usage) => Price | undefined, now: number): PiSpend {
  const days = new Map<string, number>();
  for (let i = 13; i >= 0; i--) days.set(new Date(now - i * DAY).toISOString().slice(0, 10), 0);
  const active = new Set<string>();
  const month = monthOf(now);
  const monthly: Record<string, number> = {};
  const monthAccounts = new Set<string>();
  let tokens = 0;
  for (const m of messages) {
    if (m.at > now - GAUGE_WINDOW && m.at <= now) tokens += m.usage.input + m.usage.output + m.usage.cacheRead + m.usage.cacheWrite;
    const day = new Date(m.at).toISOString().slice(0, 10);
    const price = priceOf(m.usage);
    if (price && days.has(day)) days.set(day, (days.get(day) ?? 0) + costOf(m.usage, price));
    if (day.slice(0, 7) === month && m.at <= now) {
      monthAccounts.add(m.account);
      if (price) monthly[m.account] = (monthly[m.account] ?? 0) + costOf(m.usage, price);
    }
    if (m.at > now - DAY) active.add(m.account);
  }
  return {
    spend: [...days].map(([day, dollars]) => ({ day, dollars: Math.round(dollars * 100) / 100 })),
    active: [...active].sort(),
    monthly,
    monthAccounts: [...monthAccounts].sort(),
    month,
    tokens,
  };
}

type Message = { at: number; account: string; usage: Usage };
type CacheEntry = { size: number; mtimeMs: number; messages: Message[] };

/** The counts of each session file, by its path, size and time of change. */
function cachePath(env: Env): string {
  return join(env.XDG_CACHE_HOME || join(env.HOME || homedir(), ".cache"), "lineclear", "spend.json");
}

/** One file's messages, added up per hour, provider and model: all that spend and usage need, and far smaller to keep. */
function readFileMessages(path: string): Message[] {
  const sums = new Map<string, Message>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.includes('"usage"')) continue;
    const at = Date.parse(line.match(/"timestamp":"([^"]+)"/)?.[1] ?? "");
    const [u] = sessionUsage(line);
    if (!u || Number.isNaN(at)) continue;
    const hour = at - (at % HOUR_MS);
    const key = `${hour}|${u.provider}|${u.model}`;
    const m = sums.get(key) ?? { at: hour, account: u.provider || "unknown", usage: { ...u, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    m.usage.input += u.input;
    m.usage.output += u.output;
    m.usage.cacheRead += u.cacheRead;
    m.usage.cacheWrite += u.cacheWrite;
    sums.set(key, m);
  }
  return [...sums.values()];
}

/** Messages of the session files changed since `since`. Only new and grown files are read. */
function sessionMessages(env: Env, since: number, cacheFile: string): Message[] {
  let old: Record<string, CacheEntry> = {};
  try {
    old = JSON.parse(readFileSync(cacheFile, "utf8"));
    if (!old || typeof old !== "object") old = {};
  } catch {
    // no cache yet, or a broken one: read everything
  }
  const kept: Record<string, CacheEntry> = {};
  let changed = false;
  for (const { files } of piHarness.allSessionFolders(env)) {
    for (const path of files) {
      const st = statSync(path);
      if (st.mtimeMs < since) continue;
      const hit = old[path];
      if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs && Array.isArray(hit.messages)) kept[path] = hit;
      else {
        kept[path] = { size: st.size, mtimeMs: st.mtimeMs, messages: readFileMessages(path) };
        changed = true;
      }
    }
  }
  if (changed || Object.keys(old).length !== Object.keys(kept).length) {
    try {
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeAtomic(cacheFile, JSON.stringify(kept));
    } catch {
      // a cache that cannot be written only costs the next refresh a full read
    }
  }
  return Object.values(kept).flatMap((e) => e.messages.filter((m) => m.at >= since));
}

/** Usage and spend from pi's session files of the last 14 days. */
export function piSpendAndUsage(env: Env = process.env, now = Date.now()): PiSpend {
  const dir = piDir(env);
  return spendAndUsage(
    sessionMessages(env, Math.min(now - 14 * DAY, Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1)), cachePath(env)),
    priceFinder(readJson(join(dir, "models-store.json"))),
    now,
  );
}
