import { useLayoutEffect, useRef } from "react";
import * as part from "../brand/rail.ts";
import { type Motion, play, playKey, ring, stop } from "./motion.ts";
import type { Stage } from "./parts.tsx";
import { type Placed, stageOf } from "./line-parts.tsx";
import { runRequest } from "./line-motion.tsx";

/** A train's place on its track is its progress; a new report moves it with the longest motion there is. */
const WORK_MOTION = "train-progress";

/**
 * Slides each train from where it was to where it is: a start throws the points, lights its lamp and spreads a ring
 * (`task-start`), a merge glides it into the main line with a green pulse at the junction (`task-finish`), a report
 * of progress creeps it along its zone (`train-progress`), any other change glides it with `task-move`, and a new
 * request runs from the signal box to its siding (`request-run`). A train in the middle of a glide starts from
 * where it is now. A change of width only moves.
 */
export function useGlide(
  layer: React.RefObject<HTMLUListElement | null>,
  placed: Placed[],
  w: number,
  pulses: React.RefObject<Map<string, HTMLElement>>,
  s: { spine: number; head: number },
) {
  const was = useRef<{ w: number; spots: Map<string, { x: number; y: number }>; stages: Map<string, Stage> }>(undefined);
  const gliding = useRef(new Map<string, { dx: number; dy: number; a: Animation }>());
  useLayoutEffect(() => {
    const list = layer.current;
    const where = new Map(placed.map((p) => [p.t.id, { x: p.x, y: p.y }]));
    const stages = new Map(placed.map((p) => [p.t.id, stageOf(p.t)]));
    const project = new Map(placed.map((p) => [p.t.id, p.project]));
    const prev = was.current;
    if (prev && unchanged(prev, w, where, stages)) return;
    was.current = { w, spots: where, stages };
    if (!list || !prev || !w || prev.w !== w) return;
    const els = elementsByKey(list);
    const merged = new Set<string>();
    for (const [key, to] of where) {
      const el = els.get(key);
      if (!el) continue;
      const before = prev.stages.get(key);
      const stage = stages.get(key);
      const name = project.get(key) ?? "";
      if (joined(before, stage)) merged.add(name);
      const from = prev.spots.get(key);
      if (!from) {
        if (!prev.stages.has(key) && stage !== "done") arrive(list, el, stage, to, s);
        continue;
      }
      glideTrain({ list, el, name, from, to, before, stage, run: gliding.current.get(key) }, (a) => gliding.current.set(key, a));
    }
    for (const name of merged) pulse(pulses.current.get(name));
  });
}

type Move = {
  list: HTMLElement;
  el: HTMLElement;
  name: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  before: Stage | undefined;
  stage: Stage | undefined;
  run: { dx: number; dy: number; a: Animation } | undefined;
};

/** One train that was on the line before: the points and ring of a start, and its glide. */
function glideTrain({ list, el, name, from, to, before, stage, run }: Move, remember: (g: { dx: number; dy: number; a: Animation }) => void) {
  const start = stage === "work" && before === "queued";
  if (start) throwPoints(list, name);
  const lamp = () => ring(el.querySelector<HTMLElement>("[data-train]") ?? el);
  if (from.x === to.x && from.y === to.y) {
    if (start) lamp();
    return;
  }
  const [dx, dy] = resume(run, from.x - to.x, from.y - to.y);
  const creep = stage === "work" && before === "work" && from.y === to.y;
  const motion: Motion = stage === "done" && before !== "done" ? "task-finish" : start ? "task-start" : creep ? WORK_MOTION : "task-move";
  const a = playKey("train", motion, el, glideFrames(motion, dx, dy), creep ? { ms: 1200 } : {});
  if (a) remember({ dx, dy, a });
  if (start) lamp();
}

const elementsByKey = (list: HTMLElement) => new Map([...list.children].map((el) => [(el as HTMLElement).dataset.key, el as HTMLElement]));

const joined = (before: Stage | undefined, stage: Stage | undefined) => stage === "done" && before !== undefined && before !== "done";

type Seen = { w: number; spots: Map<string, { x: number; y: number }>; stages: Map<string, Stage> };

const unchanged = (prev: Seen, w: number, where: Map<string, { x: number; y: number }>, stages: Map<string, Stage>) =>
  prev.w === w &&
  where.size === prev.spots.size &&
  [...where].every(([k, c]) => prev.spots.get(k)?.x === c.x && prev.spots.get(k)?.y === c.y && prev.stages.get(k) === stages.get(k));

/** A train in the middle of a glide starts from where it is now: the rest of that glide is added and the glide ended. */
function resume(run: { dx: number; dy: number; a: Animation } | undefined, dx: number, dy: number): [number, number] {
  if (run?.a.playState !== "running") return [dx, dy];
  const p = Number(run.a.effect?.getComputedTiming().progress ?? 1);
  run.a.cancel();
  return [dx + run.dx * (1 - p), dy + run.dy * (1 - p)];
}

/** A merge pulses at its junction, also one of a train past what fits. */
function pulse(el: HTMLElement | undefined) {
  if (!el) return;
  stop(el);
  play(
    "task-finish",
    el,
    [
      { transform: "scale(0.6)", opacity: 0.9 },
      { transform: "scale(2.4)", opacity: 0 },
    ],
    { easing: part.EASE.out },
  );
}

/** A request new to the line runs from the signal box to its siding, the train pulling in at its end. */
function arrive(list: HTMLElement, el: HTMLElement, stage: Stage | undefined, to: { x: number; y: number }, s: { spine: number; head: number }) {
  if (stage === "queued") runRequest(list, { x: s.spine, y: s.head - 40 }, to, s.spine);
  play(
    "request-run",
    el,
    [
      { transform: "translateX(-12px)", opacity: 0 },
      { transform: "none", opacity: 1 },
    ],
    { easing: part.EASE.out, delay: stage === "queued" ? 120 : 0, ms: stage === "queued" ? 160 : 280 },
  );
}

function glideFrames(motion: Motion, dx: number, dy: number): Keyframe[] {
  if (motion !== "task-finish") return [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }];
  return [
    { transform: `translate(${dx}px, ${dy}px)`, opacity: 1 },
    { opacity: 1, offset: 0.7 },
    { transform: "none", opacity: 0 },
  ];
}

/** The points of a project's track throw to the siding and back as a train leaves it. */
function throwPoints(list: HTMLElement, name: string) {
  const blade = list.parentElement?.querySelector<SVGElement>(`[data-points="${CSS.escape(name)}"] [data-blade]`);
  if (blade)
    play(
      "task-start",
      blade,
      [{ transform: "rotate(0deg)" }, { transform: "rotate(40deg)", offset: 0.3 }, { transform: "rotate(40deg)", offset: 0.7 }, { transform: "rotate(0deg)" }],
      { easing: part.EASE.inOut },
    );
}
