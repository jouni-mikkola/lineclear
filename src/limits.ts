import { join } from "node:path";
import { readAccounts } from "./full.ts";
import { configDir, readJson } from "../pi/config.ts";
import type { Limits, Window } from "../pi/extension.ts";

/** An account as Home's Usage card draws it: how full its session and its week are, as far as its provider reports. */
export interface AccountUse {
  account: string;
  session?: Window;
  week?: Window;
  /** Its week against an even spend to the reset, when the week is reported with its reset time. */
  pace?: Pace;
  /** Its provider reports no limit, or none yet. */
  unreported?: true;
}

const DAY = 86_400_000;
export const WEEK_DAYS = 7;
const WEEK = WEEK_DAYS * DAY;
/** An account may run this many points of its week ahead of an even spend before it counts as ahead: a first burst is not a pace. */
const GRACE = 5;

/** How an account's week is going against an even spend: `ahead` runs out before its reset at this rate. */
export type Pace = "ahead" | "on pace";

/** Points of the week's allowance that may be spent a day from now to the reset, or undefined when no week is reported. */
export function roomPerDay(w: Window | undefined, now: number): number | undefined {
  if (!w?.resetAt) return undefined;
  const days = Math.max((Date.parse(w.resetAt) - now) / DAY, 1 / 24);
  return Math.max(0, 100 - w.percent) / days;
}

/** The pace of an account: `ahead` when more of its week is used than the days gone allow, with a little grace. */
export function paceOf(w: Window | undefined, now: number): Pace | undefined {
  if (!w?.resetAt) return undefined;
  const left = Math.min((Date.parse(w.resetAt) - now) / DAY, WEEK_DAYS);
  // Room a day above a day's share can never run out before the reset, however much is used.
  if ((100 - w.percent) / Math.max(left, 1 / 24) > 100 / WEEK_DAYS) return "on pace";
  return w.percent > (1 - left / WEEK_DAYS) * 100 + GRACE ? "ahead" : "on pace";
}

/** A window as it stands now: one whose reset time has passed starts again at 0%. */
function current(w: Window | undefined, now: number): Window | undefined {
  if (!w) return undefined;
  return w.resetAt !== undefined && Date.parse(w.resetAt) <= now ? { percent: 0 } : w;
}

/**
 * Each account used in the last day (`active`), noted in `limits.json` in the last week, or marked full, with how
 * full its limits are. pi's extension writes `limits.json`; an account marked full is at 100% of that window until
 * its reset time. The fullest account comes first.
 */
export function usageLimits(active: string[], env = process.env, now = Date.now()): AccountUse[] {
  const noted: Record<string, Limits> = readJson(join(configDir(env), "limits.json")) ?? {};
  const full = readAccounts(env);
  const names = new Set(
    [
      ...active,
      ...Object.keys(noted).filter((a) => now - Date.parse(noted[a]!.at) < WEEK),
      ...Object.keys(full).filter((a) => full[a]!.out && (full[a]!.resetAt === undefined || Date.parse(full[a]!.resetAt!) > now)),
    ].filter((a) => !full[a]?.retired),
  );
  const out = [...names].map((account): AccountUse => {
    const n = noted[account];
    const windows = { session: current(n?.session, now), week: current(n?.week, now) };
    const f = full[account];
    if (f?.out && (f.resetAt === undefined || Date.parse(f.resetAt) > now)) {
      windows[f.window ?? "session"] = { percent: 100, ...(f.resetAt ? { resetAt: f.resetAt } : {}) };
    }
    const shown = { ...(windows.session ? { session: windows.session } : {}), ...(windows.week ? { week: windows.week } : {}) };
    const pace = paceOf(windows.week, now);
    return { account, ...shown, ...(pace ? { pace } : {}), ...(windows.session || windows.week ? {} : { unreported: true as const }) };
  });
  const top = (u: AccountUse) => Math.max(u.session?.percent ?? -1, u.week?.percent ?? -1);
  return out.sort((a, b) => top(b) - top(a) || a.account.localeCompare(b.account));
}
