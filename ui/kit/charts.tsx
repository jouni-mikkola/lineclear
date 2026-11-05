import { Collapsible } from "@base-ui/react/collapsible";
import { Progress } from "@base-ui/react/progress";
import { useLayoutEffect, useRef, useState } from "react";
import { ago, dollars, exact, MONTHS, plural } from "./format.ts";
import { useGrowingBars } from "./hooks.ts";
import { AccountHead } from "./line-parts.tsx";
import { grow } from "./motion.ts";
import { Count } from "./parts.tsx";

const dayName = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1] ?? ""} ${Number(day.slice(8, 10))}`;

/**
 * Spend per day as bars on a light axis: the top line is the dearest day, today is in full and named under its
 * bar, the rest dim. Each bar names its day and its dollars on hover, focus and tap. A bar whose day changes grows
 * to its new height.
 */
export function SpendChart({ spend, height = 72 }: { spend: { day: string; dollars: number }[]; height?: number }) {
  const max = Math.max(1, ...spend.map((d) => d.dollars));
  const today = spend.at(-1)?.dollars ?? 0;
  const total = spend.reduce((s, d) => s + d.dollars, 0);
  const [shown, setShown] = useState<number>();
  const bar = (d: number) => (d === 0 ? 2 : Math.max(3, (d / max) * height));
  const box = useGrowingBars(new Map(spend.map((d) => [d.day, bar(d.dollars)])));
  const tip = shown !== undefined ? spend[shown] : undefined;
  // a tip near an edge of the chart starts or ends at its bar, so it stays on screen
  const edge = (i: number) => (i < spend.length / 4 ? "" : i >= (spend.length * 3) / 4 ? "-translate-x-full" : "-translate-x-1/2");
  const label = (d: { day: string; dollars: number }, i: number) => `${i === spend.length - 1 ? "Today, " : ""}${dayName(d.day)}: ${dollars(d.dollars)}`;
  return (
    <figure>
      <figcaption className="flex items-end gap-6">
        <span className="grid">
          <Count value={today} format={dollars} className="text-xl font-semibold text-fg" />
          <span className="text-xs text-fg3">today</span>
        </span>
        <span className="grid">
          <Count value={total} format={dollars} className="text-base font-medium text-fg2" />
          <span className="text-xs text-fg3">{plural(spend.length, "day")}</span>
        </span>
      </figcaption>
      <div className="relative mt-5 pl-10" onPointerLeave={(e) => e.pointerType === "mouse" && setShown(undefined)}>
        <span className="absolute left-0 top-0 -translate-y-1/2 text-xs tabular-nums text-fg3" data-axis="max">
          {dollars(max)}
        </span>
        <span className="absolute left-0 bottom-0 translate-y-1/2 text-xs tabular-nums text-fg3" data-axis="zero">
          $0
        </span>
        <div
          ref={box}
          className="relative flex items-end gap-[3px] border-t border-dashed border-line"
          style={{ height }}
          role="group"
          aria-label="Spend per day"
          aria-describedby={shown !== undefined ? "spend-tip" : undefined}
          tabIndex={0}
          data-spend-bars
          onFocus={(e) => e.target === e.currentTarget && setShown((i) => i ?? spend.length - 1)}
          onBlur={() => setShown(undefined)}
          onKeyDown={(e) => {
            const to = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "Home" ? -spend.length : e.key === "End" ? spend.length : 0;
            if (!to) return;
            e.preventDefault();
            setShown((i) => Math.max(0, Math.min(spend.length - 1, (i ?? spend.length - 1) + to)));
          }}
        >
          <span className="absolute inset-x-0 bottom-0 h-px bg-line" aria-hidden="true" />
          {spend.map((d, i) => {
            const last = i === spend.length - 1;
            const on = shown === i;
            return (
              <span
                key={d.day}
                role="img"
                className="group relative flex h-full min-w-0 flex-1 items-end rounded-[2px]"
                aria-label={label(d, i)}
                data-day={d.day}
                onPointerEnter={(e) => e.pointerType === "mouse" && setShown(i)}
                onClick={() => setShown(i)}
              >
                <span
                  data-bar={d.day}
                  className={`block w-full origin-bottom rounded-t-[2px] ${last ? "bg-fg" : on ? "bg-fg2" : "bg-fg3/55"}`}
                  style={{ height: bar(d.dollars) }}
                />
              </span>
            );
          })}
          {tip && shown !== undefined && (
            <span
              id="spend-tip"
              role="tooltip"
              className={`pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-sm bg-line px-2 py-1 text-xs text-fg ${edge(shown)}`}
              style={{ left: `${((shown + 0.5) / spend.length) * 100}%` }}
              data-tip
            >
              {label(tip, shown)}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex justify-between text-xs text-fg3" aria-hidden="true">
          <span>{spend[0] ? dayName(spend[0].day) : ""}</span>
          <span className="text-fg2">Today</span>
        </div>
      </div>
    </figure>
  );
}

/** An amount in a currency. */
export interface Money {
  amount: number;
  currency: string;
}

/** One account's month. A missing number is not reported, never 0. */
export interface AccountMonth {
  account: string;
  kind: "subscription" | "free" | "extra" | "key";
  paid?: Money;
  apiEquivalent?: number;
}

/** The calendar month so far: what the subscriptions cost, and what the same tokens cost at API list prices. */
export interface MonthSpend {
  month: string;
  paid: Money[];
  /** An account's cost is not reported, so `paid` may be short. */
  paidUnknown: boolean;
  apiEquivalent?: number;
  accounts: AccountMonth[];
}

const money = ({ amount, currency }: Money) => {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: amount >= 100 ? 0 : 2 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
};

const NOT_REPORTED = "not reported";

/**
 * This month as two plain numbers: what the subscriptions cost (and keys really spent), and what the same tokens
 * would have cost at API list prices. Hover or focus a number to see it per account. Unknown says "not reported".
 */
export function MonthSpendView({ month }: { month: MonthSpend }) {
  const paid = month.paid.map(money).join(" + ");
  const api = month.apiEquivalent !== undefined ? dollars(month.apiEquivalent) : undefined;
  const line = (a: AccountMonth, of: "paid" | "api") => {
    const v = of === "paid" ? (a.paid ? money(a.paid) : undefined) : a.apiEquivalent !== undefined ? dollars(a.apiEquivalent) : undefined;
    return `${a.account}: ${v ?? NOT_REPORTED}`;
  };
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const name = MONTHS_LONG[Number(month.month.slice(5, 7)) - 1] ?? month.month;
  return (
    <div data-month={month.month}>
      <p className="text-xs text-fg3">{name} so far</p>
      <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-3">
        <span className="grid" tabIndex={0} title={month.accounts.map((a) => line(a, "paid")).join("\n")} data-paid>
          <span className="text-xl font-semibold text-fg">{paid || NOT_REPORTED}</span>
          <span className="text-xs text-fg3">paid{paid && month.paidUnknown ? ", some not reported" : ""}</span>
        </span>
        <span className="grid" tabIndex={0} title={month.accounts.map((a) => line(a, "api")).join("\n")} data-api>
          <span className="text-xl font-semibold text-fg2">{api ?? NOT_REPORTED}</span>
          <span className="text-xs text-fg3">at API prices</span>
        </span>
      </div>
    </div>
  );
}

/** How full one limit window is: used in percent and when it starts again (ISO time). */
type Window = { percent: number; resetAt?: string };
/** An account's limits, as far as its provider reports them. */
export interface AccountUse {
  account: string;
  session?: Window;
  week?: Window;
  pace?: "ahead" | "on pace";
  unreported?: true;
}
/** A task that moved to another model because its account was full. */
export interface Move {
  time: string;
  task: string;
  from: string;
  to: string;
}

const ACCOUNTS_SHOWN = 8;

/** One limit as a bar that fills to its percent, amber when full, with when it starts again. */
function LimitBar({ name, w, now }: { name: string; w?: Window; now: number }) {
  const fill = useRef<HTMLSpanElement>(null);
  const was = useRef(w?.percent ?? 0);
  const value = w?.percent ?? 0;
  useLayoutEffect(() => {
    const from = was.current;
    was.current = value;
    if (fill.current) grow(fill.current, from, value, "x");
  }, [value]);
  const full = value >= 100;
  const reset = w?.resetAt ? Date.parse(w.resetAt) : undefined;
  return (
    <div className="grid grid-cols-[56px_1fr_44px] items-center gap-x-3 gap-y-0.5 text-xs" data-limit={name.toLowerCase()}>
      <span className="text-fg2">{name}</span>
      <Progress.Root value={Math.round(value)} aria-label={`${name} limit used`}>
        <Progress.Track className="relative h-2 overflow-hidden rounded-full bg-line">
          <span
            ref={fill}
            className={`absolute inset-y-0 left-0 origin-left rounded-full ${full ? "bg-caution" : "bg-fg2"}`}
            style={{ width: `${Math.min(100, value)}%` }}
          />
        </Progress.Track>
      </Progress.Root>
      <span className={`text-right tabular-nums ${full ? "text-caution" : "text-fg"}`}>{w ? `${Math.round(value)}%` : "?"}</span>
      <span />
      <span className="text-fg3" title={reset ? exact(reset) : undefined}>
        {!w ? "not reported" : reset ? `${full ? "full, frees" : "resets"} in ${ago(now, reset)}` : "new window"}
      </span>
    </div>
  );
}

/**
 * Each account as the engine that pulls the trains, with how much of its session and its week limit is used and when
 * each starts again. An account whose provider reports no limit says so. The last moves of work off a full account
 * are behind Details.
 */
export function UsageChart({ usage, moves = [], now = Date.now() }: { usage: AccountUse[]; moves?: Move[]; now?: number }) {
  const row = (u: AccountUse) => (
    <li key={u.account} className="min-w-0" data-engine={u.account}>
      <AccountHead account={u.account} unreported={u.unreported} pace={u.pace} />
      {!u.unreported && (
        <div className="grid gap-2">
          <LimitBar name="Session" w={u.session} now={now} />
          <LimitBar name="Week" w={u.week} now={now} />
        </div>
      )}
    </li>
  );
  return (
    <div>
      <ul className="grid gap-4" data-engines>
        {usage.slice(0, ACCOUNTS_SHOWN).map(row)}
      </ul>
      {usage.length > ACCOUNTS_SHOWN && (
        <Collapsible.Root className="mt-3">
          <Collapsible.Trigger className="text-sm text-fg3 hover:text-fg">{plural(usage.length - ACCOUNTS_SHOWN, "more account")}</Collapsible.Trigger>
          <Collapsible.Panel>
            <ul className="mt-4 grid gap-4">{usage.slice(ACCOUNTS_SHOWN).map(row)}</ul>
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
      {moves.length > 0 && (
        <Collapsible.Root className="mt-4">
          <Collapsible.Trigger className="text-sm text-fg3 hover:text-fg">Details</Collapsible.Trigger>
          <Collapsible.Panel>
            <ul className="mt-2 space-y-1 text-xs text-fg2" aria-label="Moves">
              {moves.map((m) => (
                <li key={`${m.time}-${m.task}`} className="break-all">
                  {m.task} moved from {m.from} to {m.to}
                </li>
              ))}
            </ul>
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
    </div>
  );
}
