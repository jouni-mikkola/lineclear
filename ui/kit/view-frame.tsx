import { type ReactNode, useLayoutEffect, useRef } from "react";
import { KEY } from "../brand/rail.ts";
import { playKey, stop } from "./motion.ts";

/** A card nearly as large as the page in both ways has nothing to grow from: the page slides. */
const GROWS_UNDER = 0.9;
const MIN_SCALE = 0.1;

/**
 * Plays the view-change motion each time `at` changes: a view, or a place in one, such as one browser. The new view
 * slides in from the right, and from the left when `back` says the move was back. `from` is the card the move came
 * from: the view then grows out of it. `landing` is the scroll place the page lands at, which the app sets after
 * this runs, so the start is measured as if it were there already.
 */
export function ViewFrame({
  view,
  at = view,
  back = false,
  from,
  landing,
  children,
}: {
  view: string;
  at?: string;
  back?: boolean;
  from?: DOMRect;
  landing?: number;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const was = useRef(at);
  useLayoutEffect(() => {
    const el = box.current;
    if (was.current === at || !el) return;
    was.current = at;
    stop(el);
    const to = el.getBoundingClientRect();
    const top = to.top + (landing === undefined ? 0 : scrollY - landing);
    const sx = from && to.width > 0 ? from.width / to.width : 1;
    // the page is taken as a screen tall: a view that is still loading is short, and grows once it is read
    const sy = from ? from.height / innerHeight : 1;
    const grows = from && !back && Math.min(sx, sy) < GROWS_UNDER;
    const [slide, rest] = KEY.view.frames;
    const start = grows
      ? `translate(${from.left - to.left}px, ${from.top - top}px) scale(${Math.max(MIN_SCALE, sx)}, ${Math.max(MIN_SCALE, sy)})`
      : // back slides the other way
        slide.transform.replace("translateX(", `translateX(${back ? "-" : ""}`);
    playKey("view", "view-change", el, [
      { ...slide, transform: start, transformOrigin: "0 0" },
      { ...rest, transformOrigin: "0 0" },
    ]);
  }, [at, back, from, landing]);
  return (
    <div ref={box} data-view={view}>
      {children}
    </div>
  );
}
