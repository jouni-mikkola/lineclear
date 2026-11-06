import { zonedInstant, zoneOffset } from "./zone.ts";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { writeAtomic } from "../pi/atomic.ts";
import { join } from "node:path";
import { configDir, readJson } from "../pi/config.ts";
import { HOUR_MS } from "./time.ts";

/** What a provider's account is. Missing means a subscription with room. */
export interface Account {
  kind: "subscription" | "free" | "extra" | "key";
  /** The subscription is full, or the free or extra account ran out. */
  out?: boolean;
  /** When the limit ends (ISO time), if known: the account is back by itself after it. */
  resetAt?: string;
  /** Which limit is full. */
  window?: "session" | "week";
  /** What a subscription costs a month, in `currency`. Missing until the owner sets it. */
  price?: number;
  /** The currency of `price`, such as "USD" or "EUR". */
  currency?: string;
  /** The owner stopped using this account: usage and the month's spend leave it out. */
  retired?: boolean;
}

/** The account of a `provider/model` name. */
export const providerOf = (model: string) => model.split("/")[0] ?? "";

const accountsPath = (env: NodeJS.ProcessEnv) => join(configDir(env), "accounts.json");

export function readAccounts(env = process.env): Record<string, Account> {
  return readJson(accountsPath(env)) ?? {};
}

const writeAccounts = (accounts: Record<string, Account>, env = process.env) => writeAtomic(accountsPath(env), `${JSON.stringify(accounts, null, 2)}\n`);

/**
 * Sets what an account's subscription costs a month, or clears it with an empty price. Returns the problem when the
 * name, price or currency is not valid. The price is never guessed: until it is set, it is not reported.
 */
export function setPrice(name: string, price: unknown, currency: unknown, env = process.env): string | undefined {
  if (!/^[\w.@:-]{1,80}$/.test(name)) return "give an account name such as anthropic";
  const accounts = readAccounts(env);
  const old = accounts[name];
  if (price === "" || price === null) {
    const { price: _p, currency: _c, ...rest } = old ?? { kind: "subscription" as const };
    accounts[name] = rest;
  } else {
    const n = typeof price === "number" ? price : typeof price === "string" ? Number(price.replace(",", ".")) : NaN;
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return "the price must be a number, 0 or more";
    const cur = typeof currency === "string" ? currency.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(cur)) return "the currency must be a three-letter code such as USD or EUR";
    accounts[name] = { kind: "subscription", ...old, price: Math.round(n * 100) / 100, currency: cur };
  }
  writeAccounts(accounts, env);
  return undefined;
}

/** Marks an account retired, or in use again. Returns the problem when the name is not valid. */
export function setRetired(name: string, retired: unknown, env = process.env): string | undefined {
  if (!/^[\w.@:-]{1,80}$/.test(name)) return "give an account name such as anthropic";
  if (typeof retired !== "boolean") return "retired must be true or false";
  const accounts = readAccounts(env);
  const { retired: _r, ...rest } = accounts[name] ?? { kind: "subscription" as const };
  accounts[name] = retired ? { ...rest, retired } : rest;
  writeAccounts(accounts, env);
  return undefined;
}

/** Marks an account full until a time. A later reset time never shortens an earlier one. */
export function markFull(provider: string, until: Date, window: "session" | "week", env = process.env): void {
  const accounts = readAccounts(env);
  const old = accounts[provider];
  const keep = old?.out && old.resetAt !== undefined && new Date(old.resetAt) > until ? old.resetAt : until.toISOString();
  accounts[provider] = { ...old, kind: old?.kind ?? "subscription", out: true, resetAt: keep, window };
  writeAccounts(accounts, env);
}

/** Marks an account usable again: its provider reports room in every window. */
export function clearFull(provider: string, env = process.env): void {
  const accounts = readAccounts(env);
  const old = accounts[provider];
  if (!old?.out) return;
  const { out: _o, resetAt: _r, window: _w, ...rest } = old;
  accounts[provider] = rest;
  writeAccounts(accounts, env);
}

const FULL = /usage limit|session limit|weekly limit|quota exceeded|rate limit \((five_hour|seven_day)\)/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Reads a failed model call: whether it says an account's session or week is full, and when it frees up. The
 * message names the reset as `resets 8pm (Europe/Helsinki)` or `resets Oct 29, 11pm (Europe/Helsinki)`. A message
 * with no reset time gets the window's length from now: 5 hours for a session, 7 days for a week.
 */
export function readLimit(message: string, now: Date): { window: "session" | "week"; until: Date } | undefined {
  if (!FULL.test(message)) return undefined;
  const window = /weekly|seven_day|week/i.test(message) ? "week" : "session";
  const fallback = new Date(now.getTime() + (window === "week" ? 168 : 5) * HOUR_MS);
  const m = /resets\s+(?:([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?/i.exec(message);
  if (!m) return { window, until: fallback };
  try {
    const zone = m[6] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const hour = (Number(m[3]) % 12) + (m[5]!.toLowerCase() === "pm" ? 12 : 0);
    const minute = Number(m[4] ?? 0);
    const month = m[1] ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
    if (m[1] && month < 0) return { window, until: fallback };
    // The day in that zone now; a time already past there is the next day (or year).
    const local = new Date(now.getTime() + zoneOffset(zone, now));
    const at = (y: number, mo: number, d: number) => zonedInstant(zone, y, mo, d, hour, minute);
    let until = m[1] ? at(local.getUTCFullYear(), month, Number(m[2])) : at(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    if (until <= now)
      until = m[1] ? at(local.getUTCFullYear() + 1, month, Number(m[2])) : at(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
    return { window, until };
  } catch {
    return { window, until: fallback };
  }
}

/** A task that moved to another model because its account was full. */
export interface Move {
  time: string;
  task: string;
  step: string;
  from: string;
  to: string;
  why: string;
}

const movesPath = (env: NodeJS.ProcessEnv) => join(configDir(env), "moves.jsonl");

export const recordMove = (m: Move, env = process.env) => appendFileSync(movesPath(env), `${JSON.stringify(m)}\n`);

/** The moves, newest first. */
export function readMoves(env = process.env, limit = 20): Move[] {
  if (!existsSync(movesPath(env))) return [];
  const out: Move[] = [];
  for (const line of readFileSync(movesPath(env), "utf8").split("\n")) {
    try {
      if (line.trim() !== "") out.push(JSON.parse(line));
    } catch {
      // a half-written line is read again next time
    }
  }
  return out.reverse().slice(0, limit);
}
