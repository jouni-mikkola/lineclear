import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import * as part from "../brand/rail.ts";
import { count as formatCount } from "./format.ts";
import { useFadeIn, useGrowingBars } from "./hooks.ts";
import { loop, reveal } from "./motion.ts";
import { Button, LayingTrack } from "./parts.tsx";
import { Shapes, paint } from "./rail.tsx";

// The parts every view is drawn from, on the railway parts of rail.tsx: row, card, tile, bar chart, toast, side panel,
// bottom bar, side rail, parallel tracks, the stale bar and the laid track. The spec is docs/design.md; /design shows
// each part in each state. A view draws nothing of its own.

// The lamp

/** The lamp's four states: grey while a review checks, amber when it waits for you, green when clear, red when broken. */
export type LampState = "check" | "wait" | "clear" | "broken";

export const LAMP_WORD: Record<LampState, string> = { check: "being checked", wait: "waits for you", clear: "clear", broken: "broken" };

const LAMP_COLOUR: Record<LampState, string> = { check: "bg-fg3", wait: "bg-caution", clear: "bg-clear", broken: "bg-stop" };

/** A lamp. One that waits on someone blinks softly until they answer (the `lamp-wait` loop); under reduced motion it stands lit. */
export function StateLamp({ state, size = 12, label = true }: { state: LampState; size?: number; label?: boolean }) {
  const dot = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (state !== "wait" || !dot.current) return;
    const a = loop("lamp-wait", dot.current, [{ opacity: 1 }, { opacity: 0.35, offset: 0.5 }, { opacity: 1 }]);
    return () => a?.cancel();
  }, [state]);
  return (
    <span
      ref={dot}
      className={`inline-block shrink-0 rounded-full ${LAMP_COLOUR[state]}`}
      style={{ width: size, height: size }}
      data-lamp={state}
      {...(label ? { role: "img", "aria-label": LAMP_WORD[state] } : { "aria-hidden": true })}
    />
  );
}

// Row, card, tile

const ROW = "flex min-h-11 w-full min-w-0 items-center gap-3 px-4 py-2 text-left max-sm:min-h-12";

/**
 * One row of a list: a lead (a lamp, a shape), a title with a line of meta under it, and a trail (a figure, a time).
 * 44 px high on a wide screen and 48 on a phone. With `href` it is a link, with `onClick` a button, else plain.
 */
export function Row({
  lead,
  title,
  meta,
  trail,
  href,
  onClick,
  current,
  ...rest
}: {
  lead?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trail?: ReactNode;
  href?: string;
  onClick?: () => void;
  current?: boolean;
  "data-key"?: string;
}) {
  const inner = (
    <>
      {lead && <span className="flex shrink-0 items-center">{lead}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-fg">{title}</span>
        {meta && <span className="block truncate text-xs text-fg3">{meta}</span>}
      </span>
      {trail && <span className="shrink-0 text-xs tabular-nums text-fg2">{trail}</span>}
    </>
  );
  const look = `${ROW} border-t border-line first:border-t-0 ${href || onClick ? "hover:bg-raised2" : ""} ${current ? "bg-raised3" : ""}`;
  if (href)
    return (
      <a href={href} className={look} data-block data-row aria-current={current ? "page" : undefined} {...rest}>
        {inner}
      </a>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={look} data-row {...rest}>
        {inner}
      </button>
    );
  return (
    <div className={look} data-row {...rest}>
      {inner}
    </div>
  );
}

/** A list of rows on a card. */
export function RowList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div role="group" aria-label={label} className="overflow-hidden rounded-lg border border-line bg-raised">
      {children}
    </div>
  );
}

/** The surface a part sits on: 12 px corners, a 1 px line, no shadow. */
export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string; "data-testid"?: string }) {
  return (
    <div className={`min-w-0 rounded-lg border border-line bg-raised ${className}`} data-card {...rest}>
      {children}
    </div>
  );
}

/** One figure on a small card: a label, the figure with its unit, and a line under it. */
export function Tile({ label, value, unit, sub }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-fg3">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-fg" data-tile-value>
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-fg2">{unit}</span>}
      </p>
      {sub && <p className="mt-1 text-xs text-fg3">{sub}</p>}
    </Card>
  );
}

// Lists that insert and remove with their height

/**
 * One item of a list that arrives or leaves with its height: with `appear` it grows in on mount, and when `show`
 * turns false it shrinks away and then leaves the page, so the items around it slide by its size.
 */
export function Reveal({ show = true, appear, children }: { show?: boolean; appear?: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(show);
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (first.current) {
      first.current = false;
      if (show && appear) reveal(el, 0, el.offsetHeight);
      return;
    }
    if (!show) {
      const h = el.offsetHeight;
      el.style.height = "0px";
      el.style.overflow = "hidden";
      reveal(el, h, 0, () => setMounted(false));
    }
  }, [show]);
  return mounted ? (
    <div ref={box} data-reveal>
      {children}
    </div>
  ) : null;
}

// Bar chart

export interface Bar {
  key: string;
  label: string;
  value: number;
}

/**
 * Bars on a light axis: the tallest bar reaches the top line and the last one is in full. A bar that changes grows
 * to its new height. Bars are pictures with a name, not targets: the figures are in `format` for the caption.
 */
export function BarChart({ bars, height = 72, format = formatCount, label }: { bars: Bar[]; height?: number; format?: (n: number) => string; label: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const size = (v: number) => (v === 0 ? 2 : Math.max(3, (v / max) * height));
  const box = useGrowingBars(new Map(bars.map((b) => [b.key, size(b.value)])));
  return (
    <figure>
      <div
        ref={box}
        className="relative flex items-end gap-1 border-t border-dashed border-line"
        style={{ height }}
        role="img"
        aria-label={`${label}: ${bars.map((b) => `${b.label} ${format(b.value)}`).join(", ")}`}
      >
        <span className="absolute inset-x-0 bottom-0 h-px bg-line" aria-hidden="true" />
        {bars.map((b, i) => (
          <span
            key={b.key}
            data-bar={b.key}
            title={`${b.label}: ${format(b.value)}`}
            className={`block min-w-0 flex-1 origin-bottom rounded-t-sm ${i === bars.length - 1 ? "bg-fg" : "bg-fg3/55"}`}
            style={{ height: size(b.value) }}
          />
        ))}
      </div>
      <figcaption className="mt-2 flex justify-between text-xs tabular-nums text-fg3">
        <span>{bars[0]?.label}</span>
        <span className="text-fg2">{bars.at(-1) ? `${bars.at(-1)!.label}: ${format(bars.at(-1)!.value)}` : ""}</span>
      </figcaption>
    </figure>
  );
}

// Toast

/** A line that says what just happened, with Undo. It sits above the bottom bar on a phone, fades in and stays until `onClose`. */
export function Toast({
  message,
  undo = "Undo",
  onUndo,
  onClose,
  className = "fixed inset-x-4 bottom-24 z-30 mx-auto sm:bottom-6",
}: {
  message: string;
  undo?: string;
  onUndo?: () => void;
  onClose?: () => void;
  className?: string;
}) {
  const box = useFadeIn<HTMLDivElement>();
  return (
    <div
      ref={box}
      role="status"
      className={`flex w-fit max-w-full items-center gap-3 rounded-lg bg-fg py-1 pl-4 pr-1 text-sm font-medium text-base ${className}`}
      data-toast
    >
      <span className="min-w-0 truncate">{message}</span>
      {onUndo && (
        <button
          type="button"
          onClick={() => (onUndo(), onClose?.())}
          className="min-h-11 rounded-sm px-3 text-sm font-medium underline underline-offset-4 hover:bg-line/30"
        >
          {undo}
        </button>
      )}
    </div>
  );
}

// Side panel

/** A panel beside the content: a title, a close button and what it holds. It is the room for one thing opened from a row. */
export function SidePanel({ title, onClose, children }: { title: string; onClose?: () => void; children: ReactNode }) {
  const box = useFadeIn<HTMLElement>();
  return (
    <aside ref={box} aria-label={title} className="flex min-w-0 flex-col rounded-lg border border-line bg-raised sm:w-[400px]" data-side-panel>
      <div className="flex min-h-12 items-center justify-between gap-2 border-b border-line pl-4 pr-1">
        <h2 className="truncate text-lg font-semibold text-fg">{title}</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="flex size-12 items-center justify-center rounded-sm text-fg2 hover:bg-raised2 hover:text-fg"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="m2 2 10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <div className="min-w-0 p-4">{children}</div>
    </aside>
  );
}

// Navigation

export interface NavItem {
  id: string;
  label: string;
  href: string;
  /** What waits for you there; only the Inbox has one. */
  count?: number;
}

const Count = ({ n, className = "" }: { n?: number; className?: string }) =>
  n ? (
    <span className={`min-w-5 rounded-full bg-caution px-1.5 text-center text-xs font-semibold leading-5 text-base tabular-nums ${className}`} data-badge>
      {n > 99 ? "99+" : formatCount(n)}
      <span className="sr-only"> wait for you</span>
    </span>
  ) : null;

/** The bar at the bottom of a phone: one link a view, the one you are on marked with `aria-current` and a line above it. */
export function BottomBar({ items, current }: { items: NavItem[]; current: string }) {
  return (
    <nav
      aria-label="Views"
      className="grid border-t border-line bg-base"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      data-bottom-bar
    >
      {items.map((it) => {
        const on = it.id === current;
        return (
          <a
            key={it.id}
            href={it.href}
            data-block
            aria-current={on ? "page" : undefined}
            className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs hover:bg-raised2 ${on ? "text-fg" : "text-fg3"}`}
          >
            {on && <span className="absolute inset-x-0 top-0 mx-auto h-0.5 w-6 rounded-full bg-accent" aria-hidden="true" />}
            <span className="flex min-h-5 items-center gap-1">
              {it.label}
              <Count n={it.count} />
            </span>
          </a>
        );
      })}
    </nav>
  );
}

/** The rail on the left of a wide screen: the mark, which goes Home, the views, and a row for each project. */
export function SideRail({
  items,
  current,
  projects = [],
}: {
  items: NavItem[];
  current: string;
  projects?: { name: string; href: string; lamp: LampState }[];
}) {
  return (
    <nav
      aria-label="Views"
      className="flex h-full w-(--lc-rail-w) shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-railbg px-3 py-4"
      data-rail
    >
      <a href="/" data-block aria-label="Lineclear, Home" className="mb-3 flex h-10 w-full items-center gap-2.5 rounded-sm px-2 text-left hover:bg-raised2">
        <img src="/brand/mark.svg" width={24} height={24} alt="" />
        <span className="text-base font-semibold tracking-tight text-fg">Lineclear</span>
      </a>
      {items.map((it) => {
        const on = it.id === current;
        return (
          <a
            key={it.id}
            href={it.href}
            data-block
            aria-current={on ? "page" : undefined}
            className={`flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-sm hover:bg-raised2 ${on ? "bg-raised3 text-fg" : "text-fg2"}`}
          >
            <span className="flex-1">{it.label}</span>
            <Count n={it.count} />
          </a>
        );
      })}
      {projects.length > 0 && <p className="px-2.5 pb-1.5 pt-5 text-xs text-fg3">Projects</p>}
      {projects.map((p) => (
        <a
          key={p.name}
          href={p.href}
          data-block
          aria-current={current === `project:${p.name}` ? "page" : undefined}
          className={`flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-sm hover:bg-raised2 ${current === `project:${p.name}` ? "bg-raised3 text-fg" : "text-fg2"}`}
        >
          <StateLamp state={p.lamp} size={8} label={false} />
          <span className="min-w-0 flex-1 truncate" title={p.name}>
            {p.name}
          </span>
        </a>
      ))}
    </nav>
  );
}

// Parallel tracks

export type StepLook = "done" | "work" | "wait" | "next" | "ahead";

const STEP_STATION: Record<StepLook, part.StationLook> = { done: "done", work: "work", wait: "ask", next: "next", ahead: "ahead" };
const STEP_WORD: Record<StepLook, string> = { done: "merged", work: "at work", wait: "waits for you", next: "next", ahead: "ahead" };

/**
 * Steps that run side by side: one track splits at the left into a lane for each chain, and a lane has a station for
 * each of its steps in order. Nothing in a lane waits for the others.
 */
export function ParallelTracks({ lanes }: { lanes: { label: string; steps: { id: string; look: StepLook }[] }[] }) {
  const gap = 36;
  const laneH = 40;
  const x0 = 56;
  const longest = Math.max(1, ...lanes.map((l) => l.steps.length));
  const w = x0 + longest * gap + 8;
  const h = Math.max(1, lanes.length) * laneH;
  const mid = h / 2;
  return (
    <div className="overflow-x-auto" data-parallel>
      <ul className="m-0 list-none p-0" aria-label="Steps that run side by side">
        {lanes.map((l) => (
          <li key={l.label} className="sr-only">
            {l.label}: {l.steps.map((s) => `${s.id} ${STEP_WORD[s.look]}`).join(", ")}
          </li>
        ))}
      </ul>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${lanes.length} lanes of steps`} className="block">
        <Shapes shapes={part.rail(`M4 ${mid}H16`, paint)} />
        {lanes.map((l, i) => {
          const y = i * laneH + laneH / 2;
          return (
            <g key={l.label} data-lane={l.label}>
              <Shapes shapes={part.rail(`M16 ${mid}C36 ${mid} 28 ${y} ${x0 - 8} ${y}H${x0 + l.steps.length * gap - gap / 2}`, paint)} />
              {l.steps.map((s, j) => (
                <g key={s.id} transform={`translate(${x0 + j * gap} ${y})`} data-step={s.id} data-look={s.look}>
                  <Shapes shapes={part.station(STEP_STATION[s.look], paint, 6)} />
                </g>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Stale and loading

/** The bar above data that is older than it should be: the data stays on screen and the bar says since when. */
export function StaleBar({ since, onRetry }: { since: string; onRetry?: () => void }) {
  return (
    <div role="status" className="flex min-h-12 items-center gap-2.5 rounded-sm border border-line2 bg-raised2 pl-3 pr-1 text-sm text-fg2" data-stale>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
        <path d="M12 7a5 5 0 1 1-1.5-3.5M12 2v3H9" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="min-w-0 flex-1">Not updated since {since}. Retrying.</span>
      {onRetry && (
        <Button quiet onClick={onRetry}>
          Retry now
        </Button>
      )}
    </div>
  );
}

/** The loading state of every part: a track laid from left to right in the place the data will fill. */
export const LaidTrack = LayingTrack;
