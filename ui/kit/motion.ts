// Every animation in Lineclear's UI starts here, one named motion per state change and no others.
// Each runs on transform and opacity only, is under 300 ms, never blocks input, and does nothing under
// prefers-reduced-motion. The spec in words is docs/design.md. The times and easings are the picture language's
// motion tokens in ui/brand/rail.ts, which the README's films use too.

import { EASE as RAIL_EASE, KEY, MS } from "../brand/rail.ts";

export const MOTIONS = {
  "task-start": {
    ms: MS.long,
    what: "A task starts: the points throw, its train leaves its siding to its station at work and one ring spreads from its lamp.",
  },
  "task-move": { ms: MS.move, what: "A task moves: its token glides to its new station, and a new shape pops in when its state changed." },
  "task-finish": { ms: MS.long, what: "A task merges: its token glides to Main, a green signal pulses there, the track fills and the count steps up." },
  "task-wait": { ms: MS.long, what: "A task starts to wait for you: one amber ring spreads from its signal, and the signal stands lit." },
  "train-progress": {
    ms: 1200,
    what: "A worker reports progress: its train creeps along the track to the place its progress says. The one motion that may run longer than 300 ms, because it shows real progress.",
  },
  "request-run": {
    ms: MS.long,
    what: "A request is made: a dot leaves the signal box, runs along the spine and the track to its siding, and the train pulls in there while the dot pulses once at its new station.",
  },
  "load-shrink": { ms: MS.long, what: "A worker's context is compacted: the cargo of its wagon shrinks and the number under the train counts down." },
  "track-ahead": { ms: MS.long, what: "The planner writes more steps: the dashed track ahead grows from the last station." },
  "engine-swap": { ms: MS.long, what: "An account fills up and another takes over: the new engine pops in lit and the full one dims." },
  "inbox-clear": { ms: MS.long, what: "You answer an Inbox item: its signal turns green at once, its train pulls away past it, and the item leaves." },
  "inbox-arrive": { ms: MS.move, what: "An Inbox item arrives: it drops in at the top and the items below slide down." },
  "view-change": {
    ms: MS.long,
    what: "The view changes: the new view slides 24 px the way you went (back plays it the other way) as it fades in; one opened from a card grows from that card.",
  },
  "chat-open": { ms: MS.move, what: "The Chat panel opens: it slides in from the right edge." },
  "browser-open": { ms: MS.move, what: "An agent's browser opens: its card grows in from its place and the cards after it slide over." },
  "browser-close": { ms: MS.move, what: "An agent's browser closes: its card shrinks away where it was and the cards after it slide into the gap." },
  "model-move": { ms: MS.quick, what: "A model moves in its role's list: it slides to its new place and the one it passed slides the other way." },
  "chat-arrive": { ms: MS.move, what: "A chat message arrives: it slides up 12 px into place as it fades in." },
  "chat-typing": { ms: MS.long, what: "The Dispatcher writes: one grey dot after another rises and brightens." },
  "part-change": { ms: 160, what: "A part goes between empty, loading, error and filled: the new state fades in." },
  "value-change": { ms: MS.long, what: "A number or a bar changes: the number counts to its new value and the bar grows or shrinks to it." },
} as const;

export type Motion = keyof typeof MOTIONS;

const EASE = RAIL_EASE.out;

// one query, read on each motion: its answer follows the setting live
const reduce = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : undefined;
export const reducedMotion = () => !!reduce?.matches;

/** Plays one named motion on an element. Nothing runs under reduced motion. The id names the motion for tests. */
export function play(motion: Motion, el: Element, keyframes: Keyframe[], o: { ms?: number; delay?: number; easing?: string } = {}) {
  if (reducedMotion()) return undefined;
  const ms = o.ms ?? MOTIONS[motion].ms;
  const delay = o.delay ?? 0;
  if (ms + delay > MOTIONS[motion].ms) throw new Error(`${motion} runs ${ms + delay} ms, over its ${MOTIONS[motion].ms} ms`);
  return el.animate(keyframes, { duration: ms, delay, easing: o.easing ?? EASE, id: motion });
}

/** The keyframes of the loading loop that lays track, the board's too. */
export const LAY_FRAMES = [...KEY.lay.frames];

/**
 * Plays a named motion with a key motion's time and curve, the ones the board draws too (`KEY` in ui/brand/rail.ts).
 * The caller gives the keyframes: the key motion's own, or others such as a train's glide to its station.
 */
export function playKey(key: keyof typeof KEY, motion: Motion, el: Element, frames: readonly Keyframe[], o: { ms?: number } = {}) {
  return play(motion, el, [...frames], { ms: o.ms ?? KEY[key].ms, easing: KEY[key].ease });
}

/**
 * The two loops, each only while it lasts, never on a state change, so they are not among the motions above.
 * Loading lays the part's track from left to right again and again, while nothing is there to show yet. A lamp that
 * waits on someone blinks softly until they answer. None under reduced motion: the track stands laid and the lamp
 * stands lit.
 */
export const LOOPS = {
  "lamp-wait": { ms: 2000, what: "A lamp that waits on someone blinks softly, every two seconds, until they answer." },
  "track-lay": { ms: MS.lay, what: "A part loads: its track is laid from left to right, sleeper by sleeper, until the part is read." },
} as const;

/**
 * Plays the loop on an element until it leaves the page. It pauses while the tab is hidden or the element is off
 * screen, so nothing runs that nobody sees. Nothing runs under reduced motion.
 */
export function loop(name: keyof typeof LOOPS, el: Element, keyframes: Keyframe[]) {
  if (reducedMotion()) return undefined;
  const a = el.animate(keyframes, { duration: LOOPS[name].ms, iterations: Infinity, easing: "linear", id: name });
  let onScreen = true;
  const sync = () => (onScreen && !document.hidden ? a.play() : a.pause());
  const seen = (entries: IntersectionObserverEntry[]) => {
    onScreen = !!entries.at(-1)?.isIntersecting;
    sync();
  };
  const watch = typeof IntersectionObserver === "function" ? new IntersectionObserver(seen) : undefined;
  watch?.observe(el);
  document.addEventListener("visibilitychange", sync);
  const end = () => {
    watch?.disconnect();
    document.removeEventListener("visibilitychange", sync);
  };
  a.addEventListener("cancel", end);
  a.addEventListener("remove", end);
  return a;
}

/**
 * Counts what an element shows from one number to the next with the `value-change` motion, as `format` writes it.
 * The element's `data-count` holds the new number at once; only the digits on screen count. Nothing runs under
 * reduced motion.
 */
export function countTo(el: HTMLElement, from: number, to: number, format: (n: number) => string) {
  // the text node React owns, so its next render still finds it
  const write = (n: number) => (el.firstChild instanceof Text ? (el.firstChild.data = format(n)) : (el.textContent = format(n)));
  stop(el);
  el.dataset.count = String(to);
  const a = from === to ? undefined : play("value-change", el, [{ opacity: 0.7 }, { opacity: 1 }]);
  if (!a) return void write(to);
  counting.set(el, a);
  const whole = Number.isInteger(from) && Number.isInteger(to);
  const step = () => {
    if (counting.get(el) !== a) return;
    const p = a.effect?.getComputedTiming().progress;
    if (a.playState === "finished" || a.playState === "idle" || p == null) return void write(to);
    const n = from + (to - from) * p;
    write(whole ? Math.round(n) : n);
    requestAnimationFrame(step);
  };
  write(from);
  requestAnimationFrame(step);
}

const counting = new WeakMap<Element, Animation>();

/** Grows or shrinks a bar from what it showed to its new size with the `value-change` motion: `axis` scales it. */
export function grow(el: Element, from: number, to: number, axis: "x" | "y") {
  if (from === to || to <= 0) return;
  stop(el);
  const s = Math.max(0, from / to);
  play("value-change", el, [{ transform: `scale${axis.toUpperCase()}(${s})` }, { transform: "none" }]);
}

/** Stops what runs on an element, so the next motion starts from where it is on screen. */
export function stop(el: Element) {
  for (const a of el.getAnimations()) a.cancel();
}

/** A ring that spreads once from a shape and goes away. */
export function ring(host: HTMLElement) {
  if (reducedMotion()) return;
  const dot = document.createElement("span");
  dot.setAttribute("aria-hidden", "true");
  dot.className = "pointer-events-none absolute inset-0 rounded-full border-2 border-fg";
  host.append(dot);
  const a = play("task-start", dot, [
    { transform: "scale(1)", opacity: 0.8 },
    { transform: "scale(2.6)", opacity: 0 },
  ]);
  const done = () => dot.remove();
  a ? a.finished.then(done, done) : done();
}

export interface Spot {
  x: number;
  y: number;
}

/** Where each keyed child of a list sits in its layout, without transforms. */
export function layoutOf(list: HTMLElement): Map<string, Spot> {
  const at = new Map<string, Spot>();
  for (const el of list.querySelectorAll<HTMLElement>(":scope > [data-key]")) {
    at.set(el.dataset.key as string, { x: el.offsetLeft, y: el.offsetTop });
  }
  return at;
}

/**
 * Slides each keyed child from where it was on screen to its new place (FLIP). A child in the middle of a motion
 * starts from where it is now, so a change during a motion acts at once. New children play `enter` when given.
 */
export function flip(list: HTMLElement, before: Map<string, Spot>, move: Motion | ((key: string) => Motion), enter?: Motion) {
  const box = list.getBoundingClientRect();
  // every read first, then every write, so the page lays out once however many children move
  const moves: { el: HTMLElement; was?: Spot; dx: number; dy: number }[] = [];
  for (const el of list.querySelectorAll<HTMLElement>(":scope > [data-key]")) {
    const was = before.get(el.dataset.key as string);
    if (!was) {
      moves.push({ el, dx: 0, dy: 0 });
      continue;
    }
    // what a running motion adds to the layout now
    const r = el.getBoundingClientRect();
    const dx = was.x + (r.left - box.left - el.offsetLeft) - el.offsetLeft;
    const dy = was.y + (r.top - box.top - el.offsetTop) - el.offsetTop;
    if (Math.abs(dx) + Math.abs(dy) >= 0.5) moves.push({ el, was, dx, dy });
  }
  for (const { el, was, dx, dy } of moves) {
    if (!was) {
      if (enter) {
        stop(el);
        play(enter, el, [
          { transform: "translateY(-8px) scale(0.98)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ]);
      }
      continue;
    }
    stop(el);
    play(typeof move === "function" ? move(el.dataset.key as string) : move, el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }]);
  }
}

/**
 * A list item that arrives or leaves takes its height with it, so the items around it slide by their own size. It
 * runs the `inbox-arrive` time on height and opacity, from `from` to `to` px; `done` hears when it ended.
 */
export function reveal(el: HTMLElement, from: number, to: number, done?: () => void) {
  const a = reducedMotion()
    ? undefined
    : play("inbox-arrive", el, [
        { height: `${from}px`, opacity: from < to ? 0 : 1, overflow: "hidden" },
        { height: `${to}px`, opacity: from < to ? 1 : 0, overflow: "hidden" },
      ]);
  if (!a) return void done?.();
  a.finished.then(
    () => done?.(),
    () => {},
  );
}

/** The three dots of "writing" rise one after another, a beat each, until the returned stop is called. */
export function beatDots(dots: () => ArrayLike<Element>, rise: number): () => void {
  let i = 0;
  const beat = () => {
    const dot = dots()[i++ % 3];
    if (dot)
      play("chat-typing", dot, [
        { transform: "translateY(0)", opacity: 0.45 },
        { transform: `translateY(-${rise}px)`, opacity: 1, offset: 0.5 },
        { transform: "translateY(0)", opacity: 0.45 },
      ]);
  };
  beat();
  const t = setInterval(beat, 330);
  return () => clearInterval(t);
}
