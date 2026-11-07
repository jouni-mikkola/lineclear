// The kit's motion hooks: one each for a pattern that more than one part draws.
import { type RefObject, useLayoutEffect, useRef } from "react";
import { grow, layoutOf, play, type Spot, stop } from "./motion.ts";

/** Fades the element in once, when it first shows. */
export function useFadeIn<T extends HTMLElement>(): RefObject<T | null> {
  const box = useRef<T>(null);
  useLayoutEffect(() => {
    if (!box.current) return;
    stop(box.current);
    play("part-change", box.current, [{ opacity: 0 }, { opacity: 1 }]);
  }, []);
  return box;
}

/** Fades the element in and up once, when a tab's content first shows. */
export function useTabIn<T extends HTMLElement>(): RefObject<T | null> {
  const box = useRef<T>(null);
  useLayoutEffect(() => {
    if (!box.current) return;
    stop(box.current);
    play("tab-change", box.current, [
      { opacity: 0, transform: "translateY(6px)" },
      { opacity: 1, transform: "none" },
    ]);
  }, []);
  return box;
}

/** Plays `list-add` on each `[data-row-id]` in the box whose id was not there in the last render. The first render plays none. */
export function useArrivals<T extends HTMLElement>(ids: string[]): RefObject<T | null> {
  const box = useRef<T>(null);
  const was = useRef<Set<string>>(undefined);
  useLayoutEffect(() => {
    const before = was.current;
    was.current = new Set(ids);
    if (!before) return;
    for (const el of box.current?.querySelectorAll<HTMLElement>("[data-row-id]") ?? []) {
      if (before.has(el.dataset.rowId as string)) continue;
      stop(el);
      play("list-add", el, [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "none" },
      ]);
    }
  });
  return box;
}

/**
 * Grows each `[data-bar]` in the box from its height in the last render to its new one.
 * `heights` maps a bar's `data-bar` key to its height now.
 */
export function useGrowingBars(heights: Map<string, number>): RefObject<HTMLDivElement | null> {
  const box = useRef<HTMLDivElement>(null);
  const was = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    for (const el of box.current?.querySelectorAll<HTMLElement>("[data-bar]") ?? []) {
      const key = el.dataset.bar as string;
      const from = was.current.get(key);
      if (from !== undefined) grow(el, from, heights.get(key) ?? from, "y");
    }
    was.current = heights;
  });
  return box;
}

/** A resize moves a list's items without a change: its FLIP takes their new places as they are. */
export function useLayoutOnResize(ref: RefObject<HTMLElement | null>, before: { current: Map<string, Spot> | null }) {
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const o = new ResizeObserver(() => (before.current = layoutOf(list)));
    o.observe(list);
    return () => o.disconnect();
  }, [ref, before]);
}
