import { Button as BaseButton } from "@base-ui/react/button";
import { Progress } from "@base-ui/react/progress";
import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";
import { count as formatCount, MONTHS } from "./format.ts";
import { useLayoutOnResize } from "./hooks.ts";
import { countTo, flip, LAY_FRAMES, layoutOf, loop, type Motion, play, reducedMotion, type Spot, stop } from "./motion.ts";
import { NowList, type Waiting } from "./line-parts.tsx";
import { RunSwitch } from "./run-switch.tsx";
import { EmptyTrack } from "./rail.tsx";
import { Lamp, Shape, Stop, type TaskState, type Tone, type ProjectFacts, type TrainFacts, type RowFacts } from "./shapes.tsx";

/** Where a task is on the line: in line for the rules, at work, in review, ready to merge, or merged. */
export type Stage = "queued" | "work" | "review" | "ready" | "done";

export interface Task extends TrainFacts, RowFacts {
  id: string;
  title: string;
  state: TaskState;
  /** Its stage on the line; without one, its state says. */
  stage?: Stage;
  /** The roadmap step id its title starts with, such as "U20". */
  step?: string;
  result?: string;
  /** The model of the role at work on it now. */
  model?: string;
  /** Since when it is at its stage (ms). */
  since?: number;
  /** Tokens sent to the model so far. */
  input?: number;
  /** No sign of life from it for a while. */
  stalled?: boolean;
  /** Its machine did not answer the last read: when it last did (ms). */
  silentSince?: number;
}

export interface Project extends ProjectFacts {
  name: string;
  done: number;
  total: number;
  unit: "steps" | "tasks";
  broken: boolean;
  tasks: Task[];
  roadmap?: string;
  /** The current phase, the next startable step, what blocks the rest, and the estimated finish (ms). */
  phase?: string;
  next?: string;
  /** Named by its kind; `href` is the page that shows it, when there is one. */
  blocker?: { text: string; href?: string };
  finish?: number;
  /** The Lineclear project that has its space, and whether it is Paused: the rules start none of its steps. */
  project?: string;
  paused?: boolean;
  waiting?: Waiting;
}

export type PartState = "empty" | "loading" | "error" | "filled";

// Buttons

export function Button({
  children,
  onClick,
  quiet,
  submit,
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  quiet?: boolean;
  /** Sends the form it is in. */
  submit?: boolean;
  "data-testid"?: string;
}) {
  return (
    <BaseButton
      onClick={onClick}
      type={submit ? "submit" : "button"}
      className={`inline-flex min-h-9 max-w-full items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium ${
        quiet ? "bg-raised2 text-fg hover:bg-raised3" : "bg-action text-base hover:brightness-110"
      }`}
      {...rest}
    >
      {children}
    </BaseButton>
  );
}

// A part's four states

/**
 * Any part of a view in one of its four states. Loading is still blocks in the part's shape, empty says what to do,
 * error says what failed and offers a retry. A change between states fades the new one in. The `main` part holds the
 * view's one h1: while it loads, is empty or fails, that state's line is the h1.
 */
export function Part({
  state,
  label,
  empty,
  error,
  onRetry,
  rows = 3,
  main,
  children,
}: {
  state: PartState;
  label: string;
  main?: boolean;
  empty: { text: string; hint?: ReactNode };
  error?: string;
  onRetry?: () => void;
  rows?: number;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const was = useRef(state);
  useLayoutEffect(() => {
    if (was.current === state || !box.current) return;
    was.current = state;
    stop(box.current);
    play("part-change", box.current, [{ opacity: 0 }, { opacity: 1 }]);
  }, [state]);
  return (
    <div ref={box} data-part={label} data-part-state={state}>
      {state === "loading" ? (
        <div className="space-y-3" aria-busy="true" aria-label={`${label} is loading`}>
          {main && <h1 className="sr-only">{label} is loading</h1>}
          <LayingTrack />
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="h-12 rounded bg-raised" style={{ opacity: 1 - i * 0.22 }} />
          ))}
        </div>
      ) : state === "error" ? (
        <div className="flex items-start gap-3 rounded border border-stop/40 bg-raised p-4" role="alert">
          <Stop size={18} />
          <div className="min-w-0">
            <StateLine main={main} className="font-medium text-fg">
              {label} cannot be read.
            </StateLine>
            <p className="mt-1 whitespace-pre-line break-words text-sm text-fg2">{error ?? "Something went wrong."}</p>
            {onRetry && (
              <div className="mt-3">
                <Button onClick={onRetry}>Try again</Button>
              </div>
            )}
          </div>
        </div>
      ) : state === "empty" ? (
        <div className="flex flex-col items-center rounded border border-dashed border-line px-6 py-8 text-center">
          <EmptyTrack />
          <StateLine main={main} className="mt-3 text-fg">
            {empty.text}
          </StateLine>
          {empty.hint && <p className="mt-1 text-sm text-fg2">{empty.hint}</p>}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/** A state's line, the view's h1 in its `main` part. */
const StateLine = ({ main, className, children }: { main?: boolean; className: string; children: ReactNode }) =>
  main ? <h1 className={className}>{children}</h1> : <p className={className}>{children}</p>;

/** The picture of loading: a track being laid from left to right. Under reduced motion it stands laid. */
function LayingTrack() {
  const laid = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!laid.current) return;
    const a = loop("track-lay", laid.current, LAY_FRAMES);
    return () => a?.cancel();
  }, []);
  return (
    <div className="relative h-3" data-laying>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
      <div ref={laid} className="absolute inset-0 origin-left">
        <div
          className="absolute inset-x-0 top-1/2 h-[9px] -translate-y-1/2"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, var(--lc-line) 0 2px, transparent 2px 9px)" }}
        />
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-line2" />
      </div>
    </div>
  );
}

// The answer

/** The one answer a view gives first, with its lamp: a state no other part of the page says. */
export function Answer({ tone, text }: { tone: Tone; text: string }) {
  return (
    <div className="flex items-start gap-4">
      <span className="mt-2.5 md:mt-4">
        <Lamp tone={tone} size={22} />
      </span>
      <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-fg md:text-answer" data-answer>
        {text}
      </h1>
    </div>
  );
}

/** The title of a view that has no answer of its own: heard by a screen reader, never shown, so nothing is said twice. */
export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="sr-only" data-answer>
      {children}
    </h1>
  );
}

// Progress

/** A progress track that fills green. Growing plays the finish motion from wherever the fill is now. */
function Track({ value, label }: { value: number; label: string }) {
  const fill = useRef<HTMLDivElement>(null);
  const was = useRef(value);
  useLayoutEffect(() => {
    const el = fill.current;
    const from = was.current;
    was.current = value;
    if (!el || value <= from || reducedMotion()) return;
    const now = getComputedStyle(el).transform;
    stop(el);
    play("task-finish", el, [{ transform: now === "none" ? `scaleX(${from})` : now }, { transform: `scaleX(${value})` }]);
  }, [value]);
  return (
    <Progress.Root value={Math.round(value * 100)} aria-label={label}>
      <Progress.Track className="relative h-1.5 overflow-hidden rounded-full bg-line" data-track>
        <div ref={fill} className="absolute inset-0 origin-left rounded-full bg-clear" style={{ transform: `scaleX(${value})` }} />
      </Progress.Track>
    </Progress.Root>
  );
}

/** A number that counts to its new value with the `value-change` motion. `data-count` holds the new value at once. */
export function Count({ value, format = formatCount, className = "" }: { value: number; format?: (n: number) => string; className?: string }) {
  const el = useRef<HTMLSpanElement>(null);
  const was = useRef(value);
  useLayoutEffect(() => {
    const from = was.current;
    was.current = value;
    if (el.current && from !== value) countTo(el.current, from, value, format);
  }, [value]);
  return (
    <span ref={el} className={`inline-block tabular-nums ${className}`} data-count={value}>
      {format(value)}
    </span>
  );
}

// Lists that move

/**
 * Keeps a keyed list's children in place on screen across changes: each slides to its new place with `move`, a new
 * one plays `enter`, and `onLeave` hears where a child that left last sat.
 */
export function useFlip(ref: RefObject<HTMLElement | null>, move: Motion, enter?: Motion, onLeave?: (key: string, at: Spot) => void, onlyOnEnter = false) {
  const before = useRef<Map<string, Spot> | null>(null);
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const was = before.current;
    const entered = () => [...list.querySelectorAll<HTMLElement>(":scope > [data-key]")].some((el) => !was?.has(el.dataset.key as string));
    if (was && (!onlyOnEnter || entered())) {
      flip(list, was, move, enter);
      if (onLeave) {
        const now = new Set([...list.querySelectorAll<HTMLElement>(":scope > [data-key]")].map((el) => el.dataset.key));
        for (const [key, at] of was) if (!now.has(key)) onLeave(key, at);
      }
    }
    // with onlyOnEnter, anything else (an item leaving) changes at once
    before.current = layoutOf(list);
  });
  useLayoutOnResize(ref, before);
}

/**
 * Where a project is: its phase as a small label, the next step as the title, what blocks it as a badge (amber with
 * its link when it waits for you, grey when it waits for a date or a step), and when it ends. Every state has words: no roadmap, all done, all blocked, no estimate. It wraps, never cuts.
 */
const PILL = "inline-flex items-center gap-1.5 rounded-full align-middle px-2 py-0.5 text-xs font-medium";

function WhereLine({ p }: { p: Project }) {
  if (p.unit === "tasks") {
    const open = p.tasks.filter((t) => t.state !== "done").length;
    return (
      <p className="flex items-baseline gap-1.5" data-where>
        <Count value={open} className="text-base font-medium text-fg" />
        <span className="text-xs text-fg3">{open === 1 ? "task open" : "tasks open"}</span>
      </p>
    );
  }
  if (p.total > 0 && p.done >= p.total) {
    return (
      <p className="text-sm text-clear" data-where>
        Every roadmap step is done.
      </p>
    );
  }
  const d = p.finish ? new Date(p.finish) : undefined;
  // a phone shows the phase by its number, "Phase 2", in the last row to save a line; a wider screen its whole name above
  const short = p.phase?.match(/^([^:]{1,24}):\s/)?.[1] ?? p.phase;
  return (
    <div className="min-w-0 text-sm [overflow-wrap:anywhere]" data-where>
      {p.phase && (
        <p className="hidden text-xs text-fg3 sm:block" data-where-phase>
          {p.phase}
        </p>
      )}
      <p className="mt-0.5 [&>*]:mr-2.5">
        {p.next ? (
          <span className="font-medium text-fg" data-where-next>
            {p.next}
          </span>
        ) : (
          <span className="text-fg2">No step can start yet.</span>
        )}
        {p.blocker &&
          (p.blocker.href ? (
            <a href={p.blocker.href} className={`${PILL} min-h-11 md:min-h-0 bg-caution/15 text-caution hover:bg-caution/25`} data-where-blocker>
              <Shape state="need" size={9} />
              {p.blocker.text}
            </a>
          ) : (
            <span className={`${PILL} bg-raised2 text-fg2`} data-where-blocker>
              <Shape state="queued" size={9} />
              {p.blocker.text}
            </span>
          ))}
        <span className="text-xs text-fg3 sm:hidden" data-where-phase-short>
          {short}
        </span>
        <span className="whitespace-nowrap text-xs text-fg3" title="Estimated at the pace of the last 7 days" data-where-finish>
          <span className="max-sm:hidden">{d ? "done about " : ""}</span>
          {d ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : "no estimate yet"}
        </span>
      </p>
    </div>
  );
}

/** The card every Home project and every Inbox item sits on. */
const CARD = "rounded-lg bg-raised/60 p-4 md:p-5";

/** A project as its name (its heading, which says only the name), its progress track, where its roadmap stands and its work in words. Its trains are on the line above. */
export function ProjectCard({ p, onRun }: { p: Project; onRun?: (paused: boolean) => Promise<string | undefined> }) {
  const share = p.total ? Math.min(1, p.done / p.total) : 0;
  return (
    <article className={`relative grid gap-x-8 gap-y-3 md:grid-cols-[220px_1fr] ${CARD}`} data-project={p.name}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {p.broken && <Stop hidden />}
          <h3 className="min-w-0 truncate font-medium text-fg" title={p.name}>
            {p.name}
          </h3>
        </div>
        <p className="mt-0.5 text-sm text-fg3">
          {p.broken && (
            <span className="text-stop" data-project-state="broken">
              main is broken ·{" "}
            </span>
          )}
          <Count value={p.done} /> of {p.total} {p.unit} merged
          {p.roadmap && (
            <>
              {" · "}
              <a data-inline href={`/${p.roadmap}/roadmap`} className="text-fg2 underline decoration-line underline-offset-4 hover:text-fg">
                roadmap
              </a>
            </>
          )}
        </p>
        {onRun && p.paused !== undefined && (
          <p className="mt-2">
            <RunSwitch name={p.name} paused={p.paused} onChange={onRun} />
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-3">
        <Track value={share} label={`${p.name} progress`} />
        <WhereLine p={p} />
        <NowList tasks={p.tasks} waiting={p.waiting} />
      </div>
    </article>
  );
}

// Views

/** A link up to the view a page sits under, such as one browser under all of them. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-fg2 hover:text-fg md:min-h-0" data-back>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M7 1.5 3.5 5 7 8.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
      </svg>
      {children}
    </a>
  );
}
