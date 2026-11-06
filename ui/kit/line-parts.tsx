import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { ago, exact } from "./format.ts";
import * as part from "../brand/rail.ts";
import { play, stop } from "./motion.ts";
import type { Stage, Task } from "./parts.tsx";
import { EnginePic, paint, Pic, SignalPic, TrainPic } from "./rail.tsx";
import { ROLE_ICONS } from "../brand/roles.ts";
import { RoleIcon, type RoleName } from "./roles.tsx";

// The line's small parts: a train with its number, the card it shows, the signal before the junction, the key
// under the map, and the words of the same facts (the list of a project's work, an account's name line).

const STAGE_WORD: Record<Stage, string> = { queued: "in line", work: "at work", review: "in review", ready: "ready to merge", done: "merged" };
/** Who acts on a task at each stage. */
const STAGE_ROLE: Record<Stage, RoleName> = { queued: "rules", work: "worker", review: "reviewer", ready: "main", done: "main" };

export const stageOf = (t: Task): Stage => t.stage ?? (t.state === "done" ? "done" : t.state === "queued" ? "queued" : "work");
const labelOf = (t: Task) => t.step ?? t.id;
// what waits for you first, then what is furthest along
const ORDER: Record<Stage, number> = { ready: 0, review: 1, work: 2, queued: 3, done: 4 };
const rank = (t: Task) => (t.state === "need" ? -2 : t.stalled && t.state !== "done" ? -1 : ORDER[stageOf(t)]);
const byRank = (a: Task, b: Task) => rank(a) - rank(b);
// the order of the stations on a track: the roadmap's, by step id
export const byStep = (a: Task, b: Task) => labelOf(a).localeCompare(labelOf(b), "en", { numeric: true });

/** The share of its limit a worker's context fills (0 to 1), when it says. */
export const loadOf = (t: Task) => (t.load && t.load.limit > 0 ? Math.min(1, t.load.used / t.load.limit) : undefined);
/** Tokens in short: "184k". */
const kilo = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

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

/** The card a train shows on hover, focus or tap: its title and result, the role at work, the model and the time at its stage. */
export function TrainCard({ p, w, onClose }: { p: Placed; w: number; onClose: () => void }) {
  const { t } = p;
  const stage = stageOf(t);
  const width = Math.min(300, w);
  const left = Math.max(0, Math.min(p.x - 24, w - width));
  const load = t.load && stage !== "queued" ? t.load : undefined;
  // a card pinned by a tap leaves with Escape or a tap on anything but a train or the card
  useEffect(() => {
    const away = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element | null)?.closest("[data-task], [data-card]")) onClose();
    };
    addEventListener("keydown", away);
    addEventListener("pointerdown", away);
    return () => {
      removeEventListener("keydown", away);
      removeEventListener("pointerdown", away);
    };
  }, [onClose]);
  return (
    <div
      role="tooltip"
      className="absolute z-20 rounded border border-line bg-base/95 p-3 text-left shadow-[0_8px_24px_color-mix(in_srgb,var(--lc-rail-bg)_70%,transparent)]"
      style={{ left, top: p.y + 26, width }}
      data-card={t.id}
    >
      <p className="break-words text-sm font-medium text-fg">{t.title}</p>
      {t.result && (
        <p className="mt-1 break-words text-xs text-fg2" data-result>
          {t.result}
        </p>
      )}
      <p className="mt-0.5 truncate text-xs text-fg3">{p.project}</p>
      <p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-fg2">
        <RoleIcon role={STAGE_ROLE[stage]} size={14} hidden />
        <span className="min-w-0 truncate" title={t.since !== undefined ? exact(t.since) : undefined}>
          <span className="text-fg">{ROLE_ICONS[STAGE_ROLE[stage]].label}</span>
          {" · "}
          {t.state === "need" ? "waits for you" : t.stalled ? "no sign of life" : STAGE_WORD[stage]}
          {t.since !== undefined ? ` for ${ago(t.since)}` : ""}
        </span>
      </p>
      {t.model && stage !== "queued" && stage !== "done" && <p className="mt-1 truncate font-mono text-xs text-fg3">{t.model}</p>}
      {t.model && t.modelNote && stage !== "queued" && stage !== "done" && (
        <p className="mt-0.5 text-xs text-caution" data-model-note>
          {t.modelNote}
        </p>
      )}
      {load && (
        <p className="mt-0.5 text-xs text-fg3" data-load-words>
          Context {kilo(load.used)} of {kilo(load.limit)}
        </p>
      )}
      {p.href && (
        <a
          href={p.href}
          className={`mt-2 inline-flex min-h-11 items-center text-xs underline underline-offset-4 md:min-h-0 ${t.state === "need" ? "text-caution decoration-caution/40" : "text-fg2 decoration-current/40"}`}
        >
          {t.state === "need" ? "Open it in the Inbox" : "Open it"}
        </a>
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

/** The key under the map: each picture with its plain word and how many there are now. */
export function Key({ items }: { items: { pic: ReactNode; text: string; tone?: string; href?: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fg2" aria-label="What the pictures mean" data-key-list>
      {items.map((i) => (
        <li key={i.text} className="flex items-center gap-2">
          <span className="flex h-8 w-9 items-center justify-center">{i.pic}</span>
          {i.href ? (
            <a
              data-inline
              href={i.href}
              className={`inline-flex min-h-11 items-center underline decoration-current/40 underline-offset-4 md:min-h-0 ${i.tone ?? ""}`}
            >
              {i.text}
            </a>
          ) : (
            <span className={i.tone ?? ""}>{i.text}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The junction into the main line with its signal, small, for the key. */
export function JunctionPic({ aspect }: { aspect: part.SignalAspect }) {
  return (
    <Pic
      shapes={[
        ...part.rail("M-16 4H-2", paint, { w: 2 }),
        part.at(-8, 4, part.signal(aspect, paint, 0.6)),
        part.at(6, 8, part.mainLine(paint, { len: 10, w: 2 })),
      ]}
      box={[-17, -18, 34, 30]}
      width={36}
      height={32}
    />
  );
}

/**
 * A project's work in words: the current step big, the next two small, the rest as a count. Full titles that wrap,
 * never cut.
 */
export function NowList({ tasks, waiting }: { tasks: Task[]; waiting?: Waiting }) {
  const open = tasks.filter((t) => t.state !== "done").sort(byRank);
  // the three first tasks are already named above with their stage: the running group adds the rest
  const shown = new Set(open.slice(0, 3).map((t) => t.id));
  const why = waiting && <WaitingGroups waiting={{ ...waiting, running: waiting.running.filter((t) => !shown.has(t.id)) }} />;
  if (!open.length) return why || null;
  const [first, ...rest] = open as [Task, ...Task[]];
  const word = (t: Task): ReactNode => (
    <span className={t.state === "need" ? "text-caution" : "text-fg3"}>
      {" · "}
      {t.state === "need" ? "waits for you" : t.stalled ? "no sign of life" : STAGE_WORD[stageOf(t)]}
    </span>
  );
  const title = (t: Task) => (
    <a href={`/task/${encodeURIComponent(t.id)}`} className="hover:underline focus-visible:outline-2 focus-visible:outline-accent" data-task-link={t.id}>
      {t.title}
    </a>
  );
  return (
    <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]" data-now>
      <div>
        <p className="text-base text-fg" data-task-now={first.id}>
          {title(first)}
          <span className="text-sm">{word(first)}</span>
        </p>
        {rest.slice(0, 2).map((t) => (
          <p key={t.id} className="mt-0.5 text-sm text-fg2">
            {title(t)}
            {word(t)}
          </p>
        ))}
        {rest.length > 2 && <p className="mt-0.5 text-sm text-fg3">and {rest.length - 2} more</p>}
      </div>
      {why}
    </div>
  );
}

/** Why work waits in a project: what runs now, what each paused task waits for, why a ready step has not started. Each line is already in plain words. */
export interface Waiting {
  linePaused?: string;
  running: { id: string; title: string; stage: Stage; since: number }[];
  paused: { text: string; count: number }[];
  notStarted: { title: string; reason: string }[];
}

/** What runs now, what each paused task waits for and why each ready step has not started: three plain groups, each shown only when it has lines. */
function WaitingGroups({ waiting }: { waiting: Waiting }) {
  const { running, paused, notStarted, linePaused } = waiting;
  if (!running.length && !paused.length && !notStarted.length && !linePaused) return null;
  const group = (name: string, lines: ReactNode[]) =>
    lines.length > 0 && (
      <ul className="space-y-0.5 text-sm text-fg3 [overflow-wrap:anywhere]" data-waiting={name}>
        {lines.map((l, i) => (
          // lines of one group are read whole each time, never reordered by the user
          <li key={i}>{l}</li>
        ))}
      </ul>
    );
  return (
    <div className="space-y-3" data-waiting-groups>
      {group("line-paused", linePaused ? [linePaused] : [])}
      {group(
        "running",
        running.map((t) => (
          <span key={t.id} title={exact(t.since)}>
            <span className="text-fg2">{t.title}</span> · {STAGE_WORD[t.stage]} for {ago(t.since)}
          </span>
        )),
      )}
      {group(
        "paused",
        paused.map((g) => g.text),
      )}
      {group(
        "not-started",
        notStarted.map((s) => (
          <>
            <span className="text-fg2">{s.title}</span> has not started: {s.reason}
          </>
        )),
      )}
    </div>
  );
}

/** An account's name line: its engine, its name, and that its provider reports no limit or how its week runs against an even spend. */
export function AccountHead({ account, unreported, pace, fill }: { account: string; unreported?: boolean; pace?: "ahead" | "on pace"; fill?: number }) {
  return (
    <p className="mb-2 flex min-w-0 items-center gap-2 text-sm text-fg">
      <span className="shrink-0" aria-hidden="true">
        <EnginePic size={22} ink={unreported ? "fg3" : "fg"} fill={fill} />
      </span>
      <span className="min-w-0 flex-1 truncate" title={account}>
        {account}
      </span>
      {unreported && <span className="shrink-0 text-xs text-fg3">no limit reported</span>}
      {pace && (
        <span className={`shrink-0 text-xs ${pace === "ahead" ? "text-caution" : "text-fg3"}`} data-pace={pace}>
          {pace}
        </span>
      )}
    </p>
  );
}
