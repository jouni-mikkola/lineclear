// The app and the board move alike, read frame by frame. The app plays a key motion (`KEY` in ui/brand/rail.ts) on the
// design page, the board (docs/design/board.html) plays the same motion in its demo, and both are stopped at the same
// instants: the start, every 50 ms, the end. `alike.pw.ts` compares them.
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { press } from "./bar.ts";

const ROOT = join(import.meta.dirname, "..", "..");
export const BOARD_URL = `file://${join(ROOT, "docs", "design", "board.html")}`;

/** The most a motion's travel may differ from the board's at any instant, as a share of that travel: from docs/design.md. */
export function threshold(): number {
  const found = readFileSync(join(ROOT, "docs", "design.md"), "utf8").match(/Alike threshold: (\d+(?:\.\d+)?) %/);
  if (!found) throw new Error("docs/design.md has no 'Alike threshold: N %' line");
  return Number(found[1]) / 100;
}

type Channel = "x" | "opacity" | "scale" | "colour" | "dash";
export interface Pair {
  key: string;
  /** What is compared: the channel the app moves and the one the board moves, each from its start to its end. */
  channels: { app: Channel; board: Channel }[];
  /** Opens the app's page and starts the motion. */
  start: (page: Page) => Promise<void>;
  /** The app's animation: its id and a text its first keyframe has to show. */
  app: { id: string; has: string; ms: number };
  /** The board's demo, the element in it, its animation and the ms in the demo where the motion begins. */
  board: { stage: string; target: string; name: string; from: number; ms: number };
  /** The element each side is shot in, for the frames. */
  shot: { app: string; board: string };
}

const design = (testid: string) => async (page: Page) => {
  await page.goto("/design");
  await page.waitForSelector(`[data-testid="${testid}"]`);
  await page.waitForLoadState("networkidle");
  await press(page, `[data-testid="${testid}"]`);
};

// A board demo plays for seconds and holds before and after its motion; `from` is where the motion begins in it.
export const PAIRS: Pair[] = [
  {
    key: "train",
    channels: [{ app: "x", board: "x" }],
    start: design("task-move"),
    app: { id: "task-move", has: "translate", ms: 240 },
    board: { stage: ".d-merge", target: ".train", name: "m-train", from: 0, ms: 234 },
    shot: { app: '[data-line="big"]', board: ".d-merge" },
  },
  {
    key: "lamp",
    channels: [{ app: "colour", board: "colour" }],
    start: design("inbox-clear"),
    app: { id: "inbox-clear", has: "fill", ms: 200 },
    board: { stage: ".d-answer", target: ".alamp", name: "a-lamp", from: 624, ms: 192 },
    shot: { app: "[data-inbox]", board: ".d-answer" },
  },
  {
    key: "view",
    channels: [
      { app: "x", board: "x" },
      { app: "opacity", board: "opacity" },
    ],
    start: design("view-change"),
    app: { id: "view-change", has: "translate", ms: 280 },
    board: { stage: ".d-view", target: ".vto", name: "v-in", from: 544, ms: 288 },
    shot: { app: "[data-view]", board: ".d-view" },
  },
  {
    key: "lay",
    channels: [{ app: "scale", board: "dash" }],
    start: async (page) => {
      await page.goto("/?state=loading");
      await page.waitForFunction(() => document.getAnimations().some((a) => a.id === "track-lay"));
    },
    app: { id: "track-lay", has: "scale", ms: 700 },
    board: { stage: ".d-lay", target: ".layl", name: "l-lay", from: 0, ms: 700 },
    shot: { app: "[data-part]", board: ".d-lay" },
  },
];

/** The instants to read: the start, every 50 ms and the end. */
function instants(ms: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < ms; t += 50) out.push(t);
  return [...out, ms];
}

type Reading = Record<Channel, number>;

/** Holds the app's motion of the pair, started and stopped at its start. */
export async function holdApp(page: Page, pair: Pair): Promise<void> {
  await pair.start(page);
  await page.evaluate(
    ([id, has]) => {
      // every animation of the motion holds, so that the page does not move on (an answered item leaves when its pulse ends)
      for (const a of document.getAnimations()) if (a.id === id) a.pause();
      const found = document.getAnimations().find((a) => {
        if (a.id !== id) return false;
        const first = (a.effect as KeyframeEffect).getKeyframes()[0] ?? {};
        return JSON.stringify(first).includes(has as string);
      });
      if (!found) throw new Error(`the app plays no ${id} with ${has}`);
      found.pause();
      Object.assign(window, { __alike: found });
    },
    [pair.app.id, pair.app.has],
  );
}

/** Holds the board's motion of the pair, started and stopped at its start. */
export async function holdBoard(page: Page, pair: Pair): Promise<void> {
  await page.goto(BOARD_URL);
  await page.evaluate(
    ([b]) => {
      const { stage, target, name } = b as unknown as Pair["board"];
      const host = document.querySelector(stage) as HTMLElement;
      host.classList.remove("play");
      void host.offsetWidth;
      host.classList.add("play");
      const found = (host.querySelector(target) as Element).getAnimations().find((a) => (a as CSSAnimation).animationName === name);
      if (!found) throw new Error(`the board plays no ${name}`);
      found.pause();
      Object.assign(window, { __alike: found });
    },
    [pair.board],
  );
}

/** A held motion `t` ms into itself, where `from` is the ms its motion begins in the animation: what its element holds now. */
function at(page: Page, from: number, t: number): Promise<Reading> {
  return page.evaluate(
    ([from, t]) => {
      const held = (window as unknown as { __alike: Animation }).__alike;
      held.currentTime = (from as number) + (t as number);
      const css = getComputedStyle((held.effect as KeyframeEffect).target as Element);
      const m = new DOMMatrix(css.transform === "none" ? undefined : css.transform);
      const rgb = (css.fill.match(/[\d.]+/g) || []).map(Number);
      return { x: m.m41, opacity: Number(css.opacity), scale: m.m11, colour: rgb[0] ?? 0, dash: Number.parseFloat(css.strokeDashoffset) || 0 };
    },
    [from, t],
  );
}

/** The share of its travel a channel has made at each reading, 0 at the first and 1 at the last. */
function shares(readings: Reading[], channel: Channel): number[] {
  const first = readings[0]?.[channel] ?? 0;
  const span = (readings.at(-1)?.[channel] ?? 0) - first;
  // a channel that does not move stays at its start, so that a side which moves differs from it
  return readings.map((r) => (span === 0 ? 0 : (r[channel] - first) / span));
}

/** Both sides read at every instant: the shares of each compared channel, and the worst difference between them. */
export async function compare(app: Page, board: Page, pair: Pair) {
  const ts = instants(pair.app.ms);
  const a: Reading[] = [];
  const b: Reading[] = [];
  for (const t of ts) {
    a.push(await at(app, 0, t));
    b.push(await at(board, pair.board.from, Math.min(t, pair.board.ms)));
  }
  return pair.channels.map((c) => {
    const sa = shares(a, c.app);
    const sb = shares(b, c.board);
    const diffs = sa.map((v, i) => Math.abs(v - (sb[i] ?? 0)));
    return { channel: c.app, instants: ts, app: sa, board: sb, worst: Math.max(...diffs) };
  });
}
