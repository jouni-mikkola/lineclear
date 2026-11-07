import { useLayoutEffect, useRef } from "react";
import * as part from "../brand/rail.ts";
import { play } from "./motion.ts";
import type { Stage, Task } from "./parts.tsx";
import { SignalPic, TrainPic } from "./rail.tsx";

// The line's train: its number, its load and the facts every part of the line reads (stage, order, words).

export const STAGE_WORD: Record<Stage, string> = { queued: "in line", work: "at work", review: "in review", ready: "ready to merge", done: "merged" };

export const stageOf = (t: Task): Stage => t.stage ?? (t.state === "done" ? "done" : t.state === "queued" ? "queued" : "work");
const labelOf = (t: Task) => t.step ?? t.id;
// the order of the stations on a track: the roadmap's, by step id
export const byStep = (a: Task, b: Task) => labelOf(a).localeCompare(labelOf(b), "en", { numeric: true });

/** The share of its limit a worker's context fills (0 to 1), when it says. */
export const loadOf = (t: Task) => (t.load && t.load.limit > 0 ? Math.min(1, t.load.used / t.load.limit) : undefined);
/** Tokens in short: "184k". */
export const kilo = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** A train's words for a screen reader and for its card. */
const said = (t: Task, project?: string) =>
  `${labelOf(t)}: ${t.title}${project ? ` (${project})` : ""}, ${t.state === "need" ? "waits for you" : t.stalled ? "no sign of life" : STAGE_WORD[stageOf(t)]}`;

const lookOf = (t: Task, offline?: boolean): part.TrainLook =>
  offline ? "off" : t.stalled && stageOf(t) !== "done" ? "stalled" : stageOf(t) === "queued" ? "queued" : "work";

/** The amber ring around a signal that has just begun to wait: it spreads once, then the signal stands lit. */
function Halo({ now, className }: { now: boolean; className: string }) {
  const el = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (now && el.current) play("task-wait", el.current, [{ opacity: 0 }, { opacity: 0.75, offset: 0.45 }, { opacity: 0 }], { easing: part.EASE.inOut });
  }, [now]);
  return <span ref={el} aria-hidden="true" className={`pointer-events-none absolute rounded-full border-2 border-caution opacity-0 ${className}`} data-halo />;
}

/** What a train is on the map: its place, and how its words and links show. */
export interface Placed {
  t: Task;
  project: string;
  /** The middle of its train. */
  x: number;
  y: number;
  /** Where a click on it goes: the Inbox for what waits for you, else the project's roadmap. */
  href?: string;
}

export interface TrainSizes {
  phone: boolean;
  train: number;
  slot: number;
}

/** One train with its number under it (and the load it carries). A train that waits for you has an amber signal in front of it. */
export function Train({
  p,
  s,
  offline,
  onShow,
  shown,
}: {
  p: Placed;
  s: TrainSizes;
  offline?: boolean;
  onShow: (id: string | undefined, pin?: boolean) => void;
  shown?: boolean;
}) {
  const { t } = p;
  const first = useRef(t.state);
  const stage = stageOf(t);
  const gone = stage === "done";
  const need = t.state === "need" && !gone;
  const load = s.phone || stage === "queued" ? undefined : loadOf(t);
  const events = {
    onMouseEnter: () => onShow(t.id),
    onMouseLeave: () => onShow(undefined),
    onFocus: () => onShow(t.id),
    onBlur: () => onShow(undefined),
    "aria-label": said(t, p.project),
  };
  const cls = "flex w-full flex-col items-center gap-1 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  const body = (
    <>
      <span className="relative flex" data-train>
        <TrainPic look={lookOf(t, offline)} width={s.train} load={load} />
      </span>
      <span
        className={`max-w-full truncate text-xs font-semibold leading-none tabular-nums ${need && !offline ? "text-caution" : stage === "queued" ? "text-fg3" : "text-fg2"}`}
      >
        {labelOf(t)}
      </span>
    </>
  );
  return (
    <li
      data-key={t.id}
      data-task={t.id}
      data-state={t.state}
      data-stage={stage}
      data-load={load === undefined ? undefined : load.toFixed(3)}
      data-progress={t.progress === undefined ? undefined : t.progress.toFixed(2)}
      className={`absolute ${gone ? "pointer-events-none opacity-0" : ""}`}
      style={{ left: p.x - s.slot / 2, top: p.y - s.train / 4, width: s.slot }}
      aria-hidden={gone || undefined}
    >
      {need && (
        <span className="pointer-events-none absolute" style={{ left: s.slot / 2 + s.train / 2, top: s.train / 4 - 30 }} data-wait-signal>
          <SignalPic aspect={offline ? "off" : "caution"} size={30} />
          {!offline && <Halo now={first.current !== "need"} className="left-[-1px] top-px size-4" />}
        </span>
      )}
      {gone ? null : p.href ? (
        <a
          href={p.href}
          className={cls}
          {...events}
          // a touch screen has no hover: its first tap shows the card, which carries the link
          onClick={(e) => {
            if (!shown && typeof matchMedia === "function" && matchMedia("(hover: none)").matches) {
              e.preventDefault();
              onShow(t.id, true);
            }
          }}
        >
          {body}
        </a>
      ) : (
        <button type="button" className={cls} {...events} onClick={() => onShow(t.id, true)}>
          {body}
        </button>
      )}
      {!gone && load !== undefined && t.load && (
        <span className="pointer-events-none mt-0.5 block text-center text-xs leading-none tabular-nums text-fg3" data-load-num>
          {kilo(t.load.used)}
        </span>
      )}
    </li>
  );
}
