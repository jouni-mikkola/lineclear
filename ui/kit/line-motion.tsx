import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { EASE } from "../brand/rail.ts";
import { beatDots, countTo, play, reducedMotion } from "./motion.ts";
import { loadOf, type Placed } from "./line-parts.tsx";

// The line's motions that are not a train's glide: a request running to its siding, the Dispatcher's dots, a
// compaction shrinking a wagon and track being laid ahead.

/** A request leaves the signal box, runs down the spine and along the track to its siding, and pulses once there. */
export function runRequest(layer: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, spine: number) {
  if (reducedMotion()) return;
  const dot = document.createElement("span");
  dot.setAttribute("aria-hidden", "true");
  dot.className = "pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent";
  dot.style.left = `${from.x}px`;
  dot.style.top = `${from.y}px`;
  layer.append(dot);
  const down = to.y - from.y;
  const along = to.x - spine;
  const a = play(
    "request-run",
    dot,
    [
      { transform: "translate(0, 0)" },
      { transform: `translate(0, ${down}px)`, offset: 0.45 },
      { transform: `translate(${along}px, ${down}px) scale(1)`, opacity: 1, offset: 0.7 },
      // one pulse where the new station is
      { transform: `translate(${along}px, ${down}px) scale(3.2)`, opacity: 0 },
    ],
    { ms: 280, easing: EASE.inOut },
  );
  const done = () => dot.remove();
  a ? a.finished.then(done, done) : done();
}

/** The Dispatcher's dots rise one after another while it writes. Nothing runs when it does not write. */
export function useBeat(host: RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    const el = host.current;
    if (!on || !el || reducedMotion()) return;
    return beatDots(() => el.querySelectorAll("[data-dot]"), 2);
  }, [on, host]);
}

type Load = { used: number; share: number };

const scaleX = (n: number) => `scaleX(${Math.max(0.04, Math.min(1, n))})`;

/** The wagon's cargo grows or falls to its new share, and the number under the train counts to its new value. */
function playLoad(el: HTMLElement, before: Load, now: Load) {
  const cargo = el.querySelector("[data-cargo]");
  if (cargo)
    play(now.used < before.used ? "load-shrink" : "value-change", cargo, [{ transform: scaleX(before.share) }, { transform: scaleX(now.share) }], {
      easing: EASE.inOut,
    });
  const num = el.querySelector<HTMLElement>("[data-load-num]");
  if (num) countTo(num, before.used, now.used, (n) => `${Math.round(n / 1000)}k`);
}

/** A worker's context grows or is compacted: the wagon's cargo and the number under the train follow it. */
export function useCompaction(layer: RefObject<HTMLElement | null>, placed: Placed[]) {
  const was = useRef(new Map<string, Load>());
  useLayoutEffect(() => {
    const next = new Map<string, Load>();
    for (const { t } of placed) {
      const share = loadOf(t);
      if (t.load && share !== undefined) next.set(t.id, { used: t.load.used, share });
    }
    for (const [id, now] of next) {
      const before = was.current.get(id);
      const el = before && before.used !== now.used ? layer.current?.querySelector<HTMLElement>(`[data-task="${CSS.escape(id)}"]`) : undefined;
      if (before && el) playLoad(el, before, now);
    }
    was.current = next;
  });
}

/** Track being laid ahead of a project grows from its last station when the planner writes more. */
export function useTrackAhead(host: RefObject<HTMLElement | null>, ahead: [string, string][]) {
  const was = useRef(new Map<string, string>());
  useLayoutEffect(() => {
    const next = new Map(ahead);
    for (const [name, state] of next) {
      if (!state || was.current.get(name) === state || !was.current.size) continue;
      const stub = host.current?.querySelector(`[data-ahead="${CSS.escape(name)}"]`);
      if (stub)
        play(
          "track-ahead",
          stub,
          [
            { transform: "scaleX(0.05)", opacity: 0.4 },
            { transform: "none", opacity: 1 },
          ],
          { easing: EASE.out },
        );
    }
    was.current = next;
  });
}
