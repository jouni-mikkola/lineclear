import { useLayoutEffect, useRef } from "react";
import * as part from "../brand/rail.ts";
import { play, stop } from "./motion.ts";
import { Count, type Project } from "./parts.tsx";
import { SignalBoxPic, SignalPic } from "./rail.tsx";

// The words and small parts around the line's picture: zone names, the "+N" chip, the Dispatcher's window, a
// project's labels and the signal before the junction.

/** The map's sizes. A phone keeps the same picture, closer together, with no wagons. */
export interface Sizes {
  phone: boolean;
  spine: number;
  x0: number;
  train: number;
  slot: number;
  queue: number;
  gap: number;
  sig: number;
  main: number;
  head: number;
  row: number;
}
export interface More {
  key: string;
  n: number;
  x: number;
  y: number;
  need: boolean;
  what: string;
  /** Where the hidden trains are: the Inbox when one waits for you, else the project's roadmap, else the first hidden task. */
  href: string;
}
export interface Row {
  p: Project;
  top: number;
  y: number;
  done: number;
  stations: { x: number; look: part.StationLook }[];
  /** The track still to lay: where it starts, how many steps wait to be written or started. */
  ahead?: { x: number; n: number };
  signal: { x: number; aspect: part.SignalAspect };
  junction: number;
}
export interface Zones {
  /** The left edge of the track's first zone, then the borders: in line | at work | in review. */
  z0: number;
  z1: number;
  z2: number;
}

/** The zone names over the map, with how many trains each holds across all projects. */
export function ZoneNames({ zones, s, counts, junction }: { zones: Zones; s: Sizes; counts: Record<"queued" | "work" | "review", number>; junction: number }) {
  const label = (x: number, text: string, n?: number, tone = "text-fg3") => (
    <span key={text} className={`absolute whitespace-nowrap text-xs font-medium leading-none ${tone}`} style={{ left: x, top: s.head - 22 }} data-zone={text}>
      {text}
      {n !== undefined && <span className="ml-1.5 tabular-nums text-fg2">{n}</span>}
    </span>
  );
  return (
    <>
      {label(zones.z0, "In line", counts.queued)}
      {label(zones.z1 + 8, "At work", counts.work)}
      {label(zones.z2 + 8, "In review", counts.review)}
      {label(junction + 4, "main")}
    </>
  );
}

export const opens = (href: string) => (href === "/inbox" ? "the Inbox" : href.startsWith("/task/") ? "the first of them" : "the roadmap");

/** The "+N" where trains do not fit: it says what it holds and, as a link, opens where they are. */
export function MoreChip({ m }: { m: More }) {
  const tone = m.need ? "border-caution/60 text-caution" : "border-line2 text-fg3";
  const cls = `flex h-5 items-center justify-center rounded-full border bg-base text-xs font-semibold tabular-nums ${tone}`;
  return (
    <a
      href={m.href}
      className={`${cls} hover:underline focus-visible:outline-2 focus-visible:outline-accent`}
      aria-label={`${m.n} ${m.what}: open ${opens(m.href)}`}
    >
      +{m.n}
    </a>
  );
}

/** The Dispatcher's window: the signal box with its writing dots, and what waits for you. */
export function DispatcherWindow({
  head,
  s,
  waiting,
  writing,
  off,
}: {
  head: React.RefObject<HTMLDivElement | null>;
  s: Sizes;
  waiting: number;
  writing: boolean;
  off: boolean;
}) {
  return (
    <div ref={head} className="absolute left-0 top-0 z-10 flex items-center gap-3" data-signal-box data-writing={writing && !off ? "" : undefined}>
      <SignalBoxPic size={s.phone ? 30 : 34} ink={waiting && !off ? "caution" : "accent"} writing={!!writing && !off} />
      <p className="min-w-0 text-sm leading-tight">
        <span className="block font-medium text-fg">Dispatcher</span>
        {waiting ? (
          <a
            data-inline
            href="/inbox"
            className="inline-flex min-h-12 items-center text-xs text-caution md:min-h-0 underline decoration-caution/40 underline-offset-4"
          >
            {waiting} {waiting === 1 ? "waits" : "wait"} in the Inbox
          </a>
        ) : (
          <span className="text-xs text-fg3">{writing && !off ? "writing" : "nothing waits for you"}</span>
        )}
      </p>
    </div>
  );
}

/** A project's name, its count of merged work and the labels along its track. */
export function TrackLabel({ r, s, w, red }: { r: Row; s: Sizes; w: number; red: boolean }) {
  const busy = r.p.tasks.some((t) => t.state === "work");
  return (
    <div className="pointer-events-none absolute" style={{ left: s.x0, top: r.top, width: w - s.x0 }} data-track={r.p.name} data-moving={busy || undefined}>
      <p className="flex min-w-0 items-baseline gap-2 text-sm">
        <span className={`min-w-0 truncate font-medium ${busy ? "text-fg" : "text-fg2"}`} title={r.p.name}>
          {r.p.name}
        </span>
        <span className={`shrink-0 whitespace-nowrap text-xs ${red ? "text-stop" : "text-fg3"}`}>
          {red ? "main is broken" : s.phone ? `${r.p.done} of ${r.p.total}` : `${r.p.done} of ${r.p.total} ${r.p.unit} merged`}
        </span>
      </p>
      <span
        className="absolute -translate-x-1/2 whitespace-nowrap text-xs font-semibold tabular-nums leading-none text-clear"
        style={{ left: 12, top: r.y - r.top + 14 }}
        data-done
      >
        {r.done ? <Count value={r.done} /> : <span className="text-fg3">0</span>}
      </span>
      <span className="absolute whitespace-nowrap text-xs leading-none text-fg3" style={{ left: r.junction - s.x0 - 2, top: r.y - r.top + 14 }}>
        merged
      </span>
      {r.ahead && (
        <span
          className="absolute whitespace-nowrap text-xs leading-none text-fg3"
          style={{ left: r.ahead.x - s.x0 - 6, top: r.y - r.top + 14 }}
          data-ahead-label={r.ahead.n}
        >
          {r.p.planning ? "planning" : `${r.ahead.n} ahead`}
        </span>
      )}
    </div>
  );
}

/** The signal before the junction, its lamp in the review's aspect: grey while review runs, green when clear. Its lamp pops when the aspect changes. */
export function RowSignal({ x, y, aspect, offline }: { x: number; y: number; aspect: part.SignalAspect; offline?: boolean }) {
  const el = useRef<HTMLSpanElement>(null);
  const was = useRef(aspect);
  useLayoutEffect(() => {
    if (was.current === aspect || !el.current) return;
    was.current = aspect;
    stop(el.current);
    play(
      "task-move",
      el.current,
      [
        { transform: "scale(0.6)", opacity: 0.4 },
        { transform: "none", opacity: 1 },
      ],
      { easing: part.EASE.out },
    );
  }, [aspect]);
  const word = aspect === "check" ? "review: checking" : aspect === "clear" ? "review: clear" : "no review";
  return (
    <span className="pointer-events-none absolute" style={{ left: x - 5, top: y - 34 }} data-signal-review={aspect} title={word}>
      <span ref={el} className="block origin-bottom">
        <SignalPic aspect={offline ? "off" : aspect} size={34} label={word} />
      </span>
    </span>
  );
}
