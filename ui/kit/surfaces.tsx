import { useLayoutEffect, useRef } from "react";
import { count as formatCount } from "./format.ts";
import { useFadeIn } from "./hooks.ts";
import { loop } from "./motion.ts";

// The parts every view is drawn from, on the railway parts of rail.tsx: row, card, tile, bar chart, toast, side panel,
// bottom bar, side rail, parallel tracks, the stale bar and the laid track. The spec is docs/design.md. A view
// draws nothing of its own.

// The lamp

/** The lamp's four states: grey while a review checks, amber when it waits for you, green when clear, red when broken. */
export type LampState = "check" | "wait" | "clear" | "broken";

const LAMP_WORD: Record<LampState, string> = { check: "being checked", wait: "waits for you", clear: "clear", broken: "broken" };

const LAMP_COLOUR: Record<LampState, string> = { check: "bg-fg3", wait: "bg-caution", clear: "bg-clear", broken: "bg-stop" };

/** A lamp. One that waits on someone blinks softly until they answer (the `lamp-wait` loop); under reduced motion it stands lit. */
function StateLamp({ state, size = 12, label = true }: { state: LampState; size?: number; label?: boolean }) {
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

// Lists that insert and remove with their height

// Bar chart

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

// Navigation

export interface NavItem {
  id: string;
  label: string;
  href: string;
  /** Drawn before the label. */
  icon?: React.ReactNode;
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
            {it.icon}
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
            className={`flex h-11 items-center gap-2.5 rounded-sm px-2.5 text-sm hover:bg-raised2 ${on ? "bg-raised3 text-fg" : "text-fg2"}`}
          >
            {it.icon}
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

// Stale and loading
