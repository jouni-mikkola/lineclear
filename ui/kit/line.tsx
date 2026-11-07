import { useLayoutEffect, useRef, useState } from "react";
import * as part from "../brand/rail.ts";
import type { AccountUse } from "./spend-charts.tsx";
import { Count, type Project, type Stage, type Task } from "./parts.tsx";
import { byStep, JunctionPic, Key, type Placed, RowSignal, stageOf, Train, TrainCard } from "./line-parts.tsx";
import { EnginePic, paint, Shapes, SignalBoxPic, SignalPic, StationPic, TrainPic } from "./rail.tsx";
import { useGlide } from "./line-glide.tsx";
import { EngineStrip, useBeat, useCompaction, useTrackAhead } from "./line-motion.tsx";

// The line: every project as its track, drawn live in the picture language of docs/brand.md, left to right in four
// zones: in line (trains wait on the siding), at work (the train runs along the track as its worker reports), in
// review (the signal before the junction, grey while review runs, green when clear) and main (the train joins it).
// The Dispatcher's signal box is at the top, its engines beside it, and a project whose planner writes steps lays
// track ahead.

// The map's sizes. A phone keeps the same picture, closer together, with no wagons.
function sizes(w: number) {
  const phone = w < 640;
  return phone
    ? { phone, spine: 7, x0: 24, train: 28, slot: 44, queue: 40, gap: 46, sig: 36, main: 52, head: 84, row: 92 }
    : { phone, spine: 21, x0: 52, train: 32, slot: 48, queue: 54, gap: 70, sig: 52, main: 46, head: 80, row: 92 };
}
type Sizes = ReturnType<typeof sizes>;

interface More {
  key: string;
  n: number;
  x: number;
  y: number;
  need: boolean;
  what: string;
}
interface Row {
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
interface Zones {
  /** The left edge of the track's first zone, then the borders: in line | at work | in review. */
  z0: number;
  z1: number;
  z2: number;
}

/** Evenly spaced spots from `from` going `step` each, as many as fit before `to`. */
const spots = (from: number, to: number, step: number) =>
  Array.from({ length: Math.max(1, Math.floor(Math.abs(to - from) / Math.abs(step)) + 1) }, (_, i) => from + i * step);

/** Where the trains at work sit: along the zone by progress, never closer than a train and its wagon, never passing one another. */
function workSpots(list: Task[], lo: number, hi: number, gap: number) {
  const out: number[] = [];
  for (const [i, t] of list.entries()) out.push(Math.max(lo + (t.progress ?? (i + 1) / (list.length + 1)) * (hi - lo), (out[i - 1] ?? lo - gap) + gap));
  // a push past the end of the zone moves everything back from it
  let limit = hi;
  for (let i = out.length - 1; i >= 0; i--) {
    limit = Math.min(out[i] ?? limit, limit);
    out[i] = limit;
    limit -= gap;
  }
  return out;
}

const signalAspect = (review: Task[], ready: Task[]): part.SignalAspect => (review.length ? "check" : ready.length ? "clear" : "off");
const anyNeed = (tasks: Task[]) => tasks.some((t) => t.state === "need");
const look = <L extends string>(t: Task, otherwise: L) => (t.state === "need" ? "ask" : otherwise);

/** Where everything on the map sits, from the width alone, so a train's glide never measures the page. */
function layout(projects: Project[], w: number) {
  const s = sizes(w);
  const placed: Placed[] = [];
  const more: More[] = [];
  const junction = w - s.main;
  const sigX = junction - s.sig;
  const z0 = s.x0 + 28;
  const span = sigX - z0;
  const zones: Zones = { z0, z1: z0 + span * 0.32, z2: z0 + span * 0.74 };
  const rows: Row[] = projects.map((p, n) => {
    const top = s.head + n * s.row;
    const y = top + 46;
    const open = p.tasks.filter((t) => stageOf(t) !== "done");
    const of = (st: Stage) => open.filter((t) => stageOf(t) === st).sort(byStep);
    const queued = of("queued");
    // the one furthest along runs in front, so a report of progress never makes two trains pass through each other
    const byStepWork = of("work");
    const working = byStepWork
      .map((t, i) => ({ t, at: t.progress ?? (i + 1) / (byStepWork.length + 1) }))
      .sort((a, b) => a.at - b.at)
      .map((x) => x.t);
    const atSignal = of("review");
    const ready = of("ready");
    const href = (t: Task) => (t.state === "need" ? "/inbox" : p.roadmap ? `/${p.roadmap}/roadmap` : undefined);
    const put = (t: Task, x: number, dy = 0) => placed.push({ t, project: p.name, x, y: y + dy, href: href(t) });
    const fit = (list: Task[], at: number[], key: string, what: string) => {
      const show = list.length > at.length ? at.length - 1 : list.length;
      list.slice(0, show).forEach((t, i) => {
        put(t, at[i] ?? 0);
      });
      if (show < list.length) more.push({ key, n: list.length - show, x: at[show] ?? 0, y, need: anyNeed(list.slice(show)), what });
      return show;
    };
    const stations: Row["stations"] = [];
    const left = p.unit === "steps" ? Math.max(0, p.total - p.done - open.length) : 0;
    const track = spots(z0 + s.queue / 2, zones.z1 - s.queue / 2 - 6, s.queue);
    // the track ahead takes the spot after the last train in line, when it fits
    const aheadAt = !s.phone && (left > 0 || p.planning) && queued.length < track.length ? track[queued.length] : undefined;
    const inLine = aheadAt === undefined ? track : track.slice(0, -1);
    const shownQ = fit(queued, inLine, `queue-${p.name}`, "more in line");
    queued.slice(0, shownQ).forEach((t, i) => {
      stations.push({ x: inLine[i] ?? 0, look: look(t, "ahead") });
    });
    if (shownQ < queued.length) stations.push({ x: inLine[shownQ] ?? 0, look: "ahead" });
    const lo = zones.z1 + s.gap / 2 + 4;
    const hi = zones.z2 - s.gap / 2;
    const room = spots(lo, hi, s.gap).length;
    const shownW = working.length > room ? room - 1 : working.length;
    const at = workSpots(working.slice(0, shownW), lo, working.length > room ? hi - s.gap : hi, s.gap);
    working.slice(0, shownW).forEach((t, i) => {
      put(t, at[i] ?? 0);
      stations.push({ x: at[i] ?? 0, look: look(t, "work") });
    });
    if (shownW < working.length) {
      const x = hi;
      more.push({ key: `work-${p.name}`, n: working.length - shownW, x, y, need: anyNeed(working.slice(shownW)), what: "more at work" });
    }
    // the review waits before the signal, one train behind the other
    fit(atSignal, spots(sigX - 10 - s.slot / 2, zones.z2 + s.slot / 2, -(s.slot + 2)), `review-${p.name}`, "more in review");
    fit(ready, [(sigX + junction) / 2 - 2], `ready-${p.name}`, "more ready to merge");
    // a merged train has joined the main line: it stands there unseen, so its last glide ends in the right place
    for (const t of p.tasks.filter((t) => stageOf(t) === "done")) put(t, junction + 14, 8);
    const ahead = aheadAt === undefined ? undefined : { x: aheadAt, n: left };
    const aspect = signalAspect(atSignal, ready);
    return { p, top, y, done: p.done, stations, ahead, signal: { x: sigX, aspect }, junction };
  });
  const height = s.head + rows.length * s.row + (rows.length ? 0 : 20);
  return { s, rows, placed, more, height, zones };
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const o = new ResizeObserver(() => setW(el.clientWidth));
    o.observe(el);
    return () => o.disconnect();
  }, []);
  return [ref, w] as const;
}

/** The rails, stations, points and main lines of the map, in one picture under the trains. */
function Rails({
  rows,
  s,
  zones,
  w,
  h,
  broken,
  offline,
}: {
  rows: Row[];
  s: Sizes;
  zones: Zones;
  w: number;
  h: number;
  broken: Set<string>;
  offline?: boolean;
}) {
  const shapes: part.Shape[] = [];
  const last = rows.at(-1);
  const tie = { w: 3, tie: "line" as const };
  const divider = (x: number) => ({
    tag: "path" as const,
    a: { d: `M${x} ${s.head - 24}V${h - 6}`, stroke: paint("line"), "stroke-width": 1, "stroke-dasharray": "2 6", fill: "none" },
  });
  if (last) {
    shapes.push(...part.rail(`M${s.spine} ${s.head - 44}V${last.y - 26}`, paint, tie));
    shapes.push(divider(zones.z1), divider(zones.z2));
  }
  for (const r of rows) {
    // a track with every step merged and nothing open is clear: its rail turns green
    const clear = r.p.total > 0 && r.p.done >= r.p.total && !r.stations.length && r.signal.aspect === "off";
    shapes.push(
      ...part.rail(`M${s.spine} ${r.y - 28}Q${s.spine} ${r.y} ${s.spine + 22} ${r.y}H${r.junction - 12}`, paint, clear ? { ...tie, ink: "clear" } : tie),
    );
    shapes.push(part.at(r.junction, r.y + 8, part.mainLine(paint, { len: w - r.junction - 3, broken: broken.has(r.p.name) && !offline })));
    shapes.push(part.at(s.x0 + 12, r.y, part.station(r.done ? "done" : "ahead", paint, 7)));
    shapes.push(part.at(zones.z1, r.y, part.points(paint), { "data-points": r.p.name }));
    for (const st of r.stations) shapes.push(part.at(st.x, r.y, part.station(st.look, paint, 5)));
    if (r.ahead) {
      // the track ahead: dashed sleepers where it is yet to be laid, with the planner's pencil at its tip when one writes
      const stub = part.at(0, 0, [
        {
          tag: "path",
          a: { d: `M0 0H${Math.min(28, zones.z1 - 10 - r.ahead.x)}`, stroke: paint("fg3"), "stroke-width": 2, "stroke-dasharray": "3 5", fill: "none" },
        },
        ...(r.p.planning ? [part.at(Math.min(28, zones.z1 - 10 - r.ahead.x), 0, part.planner(paint))] : []),
      ]);
      shapes.push(part.at(r.ahead.x, r.y, [{ tag: "g", a: { "data-ahead": r.p.name, style: "transform-box:fill-box;transform-origin:left" }, kids: [stub] }]));
    }
  }
  return (
    <svg width={w} height={h} className="absolute inset-0 overflow-visible" aria-hidden="true">
      <Shapes shapes={shapes} />
    </svg>
  );
}

/** The zone names over the map, with how many trains each holds across all projects. */
function ZoneNames({ zones, s, counts, junction }: { zones: Zones; s: Sizes; counts: Record<"queued" | "work" | "review", number>; junction: number }) {
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

/** The Dispatcher's window: the signal box with its writing dots, and what waits for you. */
function DispatcherWindow({
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
function TrackLabel({ r, s, w, red }: { r: Row; s: Sizes; w: number; red: boolean }) {
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

type KeyFacts = {
  working: number;
  queued: number;
  waiting: number;
  review: number;
  ready: number;
  merged: number;
  planning: boolean;
  accounts: number;
  broken: number;
};

/** What the pictures mean, each with this moment's count. */
function LineKey({ facts }: { facts: KeyFacts }) {
  const { working, queued, waiting, review, ready, merged, planning, accounts, broken } = facts;
  return (
    <Key
      items={[
        { pic: <TrainPic look="work" width={26} />, text: `${working} at work` },
        { pic: <TrainPic look="queued" width={26} />, text: `${queued} in line` },
        {
          pic: <SignalPic aspect="caution" size={26} />,
          text: waiting ? `${waiting} ${waiting === 1 ? "waits" : "wait"} for you` : "nothing waits for you",
          tone: waiting ? "text-caution" : undefined,
          href: waiting ? "/inbox" : undefined,
        },
        { pic: <JunctionPic aspect={review ? "check" : "clear"} />, text: review || !ready ? `${review} in review` : `${ready} ready to merge` },
        ...(review && ready ? [{ pic: <JunctionPic aspect="clear" />, text: `${ready} ready to merge` }] : []),
        { pic: <StationPic look="done" size={14} />, text: `${merged} merged`, tone: merged ? "text-clear" : undefined },
        ...(planning
          ? [
              {
                pic: (
                  <span className="text-fg3" aria-hidden="true">
                    - - -
                  </span>
                ),
                text: "track being laid ahead",
              },
            ]
          : []),
        ...(accounts ? [{ pic: <EnginePic size={24} fill={0.6} />, text: `${accounts} ${accounts === 1 ? "account" : "accounts"}` }] : []),
        ...(broken
          ? [
              {
                pic: <span className="h-1.5 w-7 rounded-full bg-stop" />,
                text: broken === 1 ? "main is broken" : `main is broken in ${broken}`,
                tone: "text-stop",
              },
            ]
          : []),
      ]}
    />
  );
}

/**
 * The line, big: the signal box of the Dispatcher with the engines of the accounts, and each project as its track
 * through the four zones, with its merged steps, a train per open task, the review's signal before the main line,
 * and a key in plain words under it. `offline` is when the server last answered, while it does not.
 */
export function TheLine({
  projects,
  waiting = 0,
  inbox = {},
  offline,
  writing,
  accounts = [],
  legend = true,
}: {
  projects: Project[];
  waiting?: number;
  inbox?: Record<string, string>;
  offline?: number;
  /** The Dispatcher is writing: the dots show in its window. */
  writing?: boolean;
  accounts?: AccountUse[];
  /** Whether the key of counts and words stands under the line. */
  legend?: boolean;
}) {
  const [box, w] = useWidth();
  const layer = useRef<HTMLUListElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const pulses = useRef(new Map<string, HTMLElement>());
  const [shown, setShown] = useState<{ id: string; pin: boolean }>();
  const { s, rows, placed, more, height, zones } = w
    ? layout(projects, w)
    : { s: sizes(1000), rows: [], placed: [], more: [], height: 0, zones: { z0: 0, z1: 0, z2: 0 } };
  const off = offline !== undefined;
  useGlide(layer, placed, w, pulses, s);
  useBeat(head, !!writing && !off);
  useCompaction(layer, placed);
  useTrackAhead(
    box,
    rows.map((r) => [r.p.name, r.ahead ? `${r.p.planning ? "p" : ""}${r.ahead.n}` : ""]),
  );
  const card = shown && placed.find((p) => p.t.id === shown.id && stageOf(p.t) !== "done");
  const all = projects.flatMap((p) => p.tasks);
  const n = (f: (t: Task) => boolean) => all.filter(f).length;
  const working = n((t) => t.state === "work");
  const queued = n((t) => stageOf(t) === "queued");
  const review = n((t) => stageOf(t) === "review");
  const ready = n((t) => stageOf(t) === "ready");
  const merged = projects.reduce((a, p) => a + p.done, 0);
  const broken = new Set(projects.filter((p) => p.broken).map((p) => p.name));
  const planning = projects.some((p) => p.planning);
  const show = (id: string | undefined, pin?: boolean) => setShown(id ? { id, pin: !!pin && shown?.id !== id } : shown?.pin ? shown : undefined);
  const inLine = (id: string) => inbox[id];

  return (
    <div data-line="big" data-phone={s.phone || undefined}>
      <div
        ref={box}
        className={`relative [contain:layout_style] ${off ? "opacity-50 grayscale" : ""}`}
        style={{ height: w ? height : 120 }}
        onMouseLeave={() => !shown?.pin && setShown(undefined)}
      >
        {w > 0 && (
          <>
            <Rails rows={rows} s={s} zones={zones} w={w} h={height} broken={broken} offline={off} />
            <DispatcherWindow head={head} s={s} waiting={waiting} writing={!!writing} off={off} />
            {accounts.length > 0 && (
              <EngineStrip
                accounts={accounts}
                active={new Set(all.filter((t) => t.account && (t.state === "work" || stageOf(t) === "review")).flatMap((t) => (t.account ? [t.account] : [])))}
                phone={s.phone}
              />
            )}
            <ZoneNames zones={zones} s={s} counts={{ queued, work: working, review }} junction={w - s.main} />
            {rows.map((r) => (
              <TrackLabel key={r.p.name} r={r} s={s} w={w} red={broken.has(r.p.name)} />
            ))}
            {rows.map((r) => (
              <RowSignal key={r.p.name} x={r.signal.x} y={r.y} aspect={r.signal.aspect} offline={off} />
            ))}
            {rows.map((r) => (
              <span
                key={r.p.name}
                ref={(el) => void (el ? pulses.current.set(r.p.name, el) : pulses.current.delete(r.p.name))}
                aria-hidden="true"
                className="pointer-events-none absolute size-4 rounded-full border-2 border-clear opacity-0"
                style={{ left: r.junction - 2, top: r.y }}
                data-pulse
              />
            ))}
            <ul ref={layer} className="absolute inset-0" aria-label="Tasks on the line">
              {placed.map((p) => (
                <Train key={p.t.id} p={{ ...p, href: inLine(p.t.id) ?? p.href }} s={s} offline={off} onShow={show} shown={shown?.id === p.t.id} />
              ))}
              {more.map((m) => (
                <li
                  key={m.key}
                  data-key={m.key}
                  className="absolute"
                  style={{ left: m.x - s.slot / 2, top: m.y - 9, width: s.slot }}
                  title={`${m.n} ${m.what}`}
                >
                  <span
                    className={`flex h-5 items-center justify-center rounded-full border bg-base text-xs font-semibold tabular-nums ${m.need ? "border-caution/60 text-caution" : "border-line2 text-fg3"}`}
                  >
                    +{m.n}
                  </span>
                </li>
              ))}
            </ul>
            {card && <TrainCard p={{ ...card, href: inLine(card.t.id) ?? card.href }} w={w} onClose={() => setShown(undefined)} />}
          </>
        )}
      </div>
      {legend && (
        <div className="mt-5 border-t border-line pt-4">
          <LineKey facts={{ working, queued, waiting, review, ready, merged, planning, accounts: accounts.length, broken: broken.size }} />
        </div>
      )}
    </div>
  );
}
