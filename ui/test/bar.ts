// The UI bar as test helpers, for the design page and every view after it.
import { expect, type Page, test } from "@playwright/test";
import { MOTIONS, type Motion } from "../kit/motion.ts";

export const PAGE_STATES = ["filled", "empty", "loading", "error", "long", "many"] as const;

/** Each state of a page, full length, against its committed picture. */
export async function shotEveryState(page: Page, path: string, name: string) {
  for (const state of PAGE_STATES) {
    await page.goto(`${path}?state=${state}`);
    // the page draws its parts a moment after it loads
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => document.getAnimations().every((a) => a.id !== "part-change"));
    await expect(page).toHaveScreenshot(`${name}-${state}.png`, { fullPage: true });
  }
}

/** The link to a view in the navigation you can see: the rail from 1024 px, the bottom bar under it. */
export const TAB = (path: string) => `nav[aria-label="Views"] a[href="${path}"]:visible`;

export interface Frames {
  frames: number;
  fps: number;
  worstMs: number;
  longTasks: number[];
}

const CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "toplevel",
  "blink",
  "cc",
  "gpu",
].join(",");

/**
 * Runs `act` inside a browser performance trace and reads the frames drawn while the motion runs, and every task on
 * the page's main thread over 50 ms.
 */
export async function traceMotion(page: Page, act: () => Promise<void>, ms: number): Promise<Frames> {
  const cdp = await page.context().newCDPSession(page);
  const events: any[] = [];
  cdp.on("Tracing.dataCollected", (e) => events.push(...e.value));
  const done = new Promise<void>((r) => cdp.once("Tracing.tracingComplete", () => r()));
  await cdp.send("Tracing.start", { categories: CATEGORIES, transferMode: "ReportEvents" });
  await page.waitForTimeout(200);
  await act();
  await page.waitForTimeout(ms + 300);
  await cdp.send("Tracing.end");
  await done;
  await cdp.detach();
  return readFrames(events, ms);
}

/**
 * Frames from a Chromium trace: the compositor's begin frames from the click (or the page's `console.timeStamp("act")`,
 * for a change that comes from the server) until the motion ends, and the tasks on the page's main thread over 50 ms
 * in that time.
 */
function readFrames(events: any[], ms: number): Frames {
  const main = new Set(events.filter((e) => e.ph === "M" && e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
  const click =
    events.find((e) => e.name === "EventDispatch" && e.args?.data?.type === "click") ??
    events.find((e) => e.name === "TimeStamp" && e.args?.data?.message === "act");
  if (!click) throw new Error("no click in the trace");
  const from = click.ts as number;
  const to = from + ms * 1000;
  const begins = events
    .filter((e) => e.name === "Scheduler::BeginFrame" && e.ts >= from && e.ts <= to)
    .map((e) => e.ts as number)
    .sort((a, b) => a - b)
    .filter((t, i, all) => i === 0 || t - (all[i - 1] as number) > 2000);
  const gaps = begins.slice(1).map((t, i) => (t - (begins[i] as number)) / 1000);
  const longTasks = events
    .filter((e) => e.name === "RunTask" && e.ph === "X" && main.has(`${e.pid}:${e.tid}`) && e.dur > 50_000 && e.ts + e.dur >= from && e.ts <= to)
    .map((e) => Math.round(e.dur / 1000));
  const avg = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : Infinity;
  return { frames: begins.length, fps: Math.round(1000 / avg), worstMs: Math.round(Math.max(0, ...gaps)), longTasks };
}

/** The motions running now, by id, with their full time in ms. A loop is not one: `loops` lists those. */
export function running(page: Page) {
  return page.evaluate(() =>
    document
      .getAnimations()
      // a hover is a CSS transition of 120 ms on a fill (kit.css), checked on its own in kit.pw.ts; a loop repeats
      .filter((a) => a.effect?.getTiming().iterations !== Infinity && !(a instanceof CSSTransition))
      .map((a) => {
        const t = a.effect?.getTiming();
        return { id: a.id, ms: Number(t?.duration ?? 0) + Number(t?.delay ?? 0) };
      }),
  );
}

/** The loops running now: the ids of animations that repeat without end. Only two may exist, each only while it lasts. */
export function loops(page: Page) {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.getTiming().iterations === Infinity)
      .map((a) => a.id),
  );
}

/** Clicks an element by selector inside the page, so the page does not scroll to it. */
/** The rail and the bottom bar are both in the page, one hidden: this clicks the first element of the selector that is drawn. `:visible` is allowed. */
export const press = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const all = [...document.querySelectorAll<HTMLElement>(s.replace(/:visible/g, ""))];
    (all.find((e) => e.getClientRects().length > 0) ?? (all[0] as HTMLElement)).click();
  }, selector);

/**
 * Starts a motion with one click, then clicks again `after` ms into it, and returns how many ms the second click took
 * to show (`shown` is a JS expression that is true once it shows) and whether it showed by the next frame.
 */
export function clickMidMotion(page: Page, first: string, second: string, shown: string, after = 100) {
  return page.evaluate(
    async ({ first, second, shown, after }) => {
      const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
      const is = new Function(`return (${shown})`) as () => boolean;
      const pick = (s: string) => {
        const all = [...document.querySelectorAll<HTMLElement>(s.replace(/:visible/g, ""))];
        return all.find((e) => e.getClientRects().length > 0) ?? (all[0] as HTMLElement);
      };
      pick(first).click();
      await new Promise((r) => setTimeout(r, after));
      const midMotion = document.getAnimations().length > 0;
      const t0 = performance.now();
      pick(second).click();
      const now = is();
      await frame();
      return { midMotion, now, nextFrame: is(), ms: Math.round(performance.now() - t0) };
    },
    { first, second, shown, after },
  );
}

export const NAMES = Object.keys(MOTIONS) as Motion[];

const LIVE_READS = ["/api/home", "/api/inbox", "/api/settings"];

/**
 * The page reads the server again now. A page that holds a live stream only hears of a change at the server's next beat,
 * so the answers it watches are read here: the server then pushes what changed down the stream.
 */
export const reread = (page: Page) =>
  page.evaluate(async (paths) => {
    window.dispatchEvent(new Event("visibilitychange"));
    // a server that is down or slow is the test, not a failure of the read
    await Promise.all(paths.map((p) => fetch(p).catch(() => undefined)));
    // the answers are read, so the change is on its way down the stream
    console.timeStamp("act");
  }, LIVE_READS);

/** What a second click showed: whether a motion was still running, whether it showed by the next frame, and how long it took. */
export interface Mid {
  midMotion: boolean;
  nextFrame: boolean;
  ms: number;
}

/** Tells the page to read again, waits `after` ms into motion `m`, then clicks `second` and reports how it showed (`shown` is a JS expression). */
export const clickAfterReread = (page: Page, m: Motion, second: string, shown: string): Promise<Mid> =>
  page.evaluate(
    async ({ m, second, shown, after, paths }) => {
      const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
      const is = new Function(`return (${shown})`) as () => boolean;
      window.dispatchEvent(new Event("visibilitychange"));
      for (const p of paths) fetch(p).catch(() => undefined);
      const t = performance.now();
      while (!document.getAnimations().some((a) => a.id === m) && performance.now() - t < 3000) await frame();
      await new Promise((r) => setTimeout(r, after));
      const midMotion = document.getAnimations().length > 0;
      const t0 = performance.now();
      // the rail and the bottom bar are both in the page: click the one that is drawn
      const all = [...document.querySelectorAll<HTMLElement>(second.replace(/:visible/g, ""))];
      (all.find((e) => e.getClientRects().length > 0) ?? (all[0] as HTMLElement)).click();
      await frame();
      return { midMotion, nextFrame: is(), ms: Math.round(performance.now() - t0) };
    },
    { m, second, shown, after: MOTIONS[m].ms / 2, paths: LIVE_READS },
  );

/** What a view must do for each of its live motions; `liveMotionTests` runs the same four checks on every one. */
export interface MotionSuite<L extends { after: string }> {
  moves: [Motion, L][];
  fresh: (page: Page, live: L) => Promise<void>;
  /** Sets the change up before the page is told, such as a file written. */
  prepare?: (live: L, page: Page) => void | Promise<void>;
  /** Tells the page, the moment its motion should start. */
  act: (page: Page, live: L) => Promise<unknown>;
  /** True when `act` starts the motion in the same task, so it is already running when `act` returns. */
  immediate?: boolean;
  /** A second click in the middle of the motion. */
  click: (page: Page, m: Motion, live: L) => Promise<Mid>;
}

/** For each live motion: only named motions under 300 ms, 60 fps in a trace, a click during it acts at once, instant with reduced motion. */
export function liveMotionTests<L extends { after: string }>(o: MotionSuite<L>) {
  for (const [m, live] of o.moves) {
    test(`${m}: only named motions, each under 300 ms`, async ({ page }) => {
      await o.fresh(page, live);
      await o.prepare?.(live, page);
      await o.act(page, live);
      if (!o.immediate) {
        await page.waitForFunction(live.after);
        await page.waitForFunction((id) => document.getAnimations().some((a) => a.id === id), m, { timeout: 3000 });
      }
      const now = await running(page);
      expect(now.map((a) => a.id)).toContain(m);
      for (const a of now) {
        expect(NAMES).toContain(a.id as Motion);
        // only a move along the track that shows real progress may take longer
        expect(a.ms).toBeLessThan(a.id === "train-progress" ? 1300 : 300);
      }
    });

    test(`${m}: 60 fps in a performance trace, no long task`, async ({ page }) => {
      await o.fresh(page, live);
      await o.prepare?.(live, page);
      const f = await traceMotion(page, async () => void (await o.act(page, live)), MOTIONS[m].ms);
      test.info().annotations.push({ type: "frames", description: JSON.stringify(f) });
      expect(await page.evaluate(live.after)).toBe(true);
      expect(f.frames).toBeGreaterThan(MOTIONS[m].ms / 17 - 3);
      expect(f.fps).toBeGreaterThanOrEqual(58);
      expect(f.worstMs).toBeLessThan(34);
      expect(f.longTasks).toEqual([]);
    });

    test(`${m}: a click during it acts at once`, async ({ page }) => {
      await o.fresh(page, live);
      await o.prepare?.(live, page);
      const r = await o.click(page, m, live);
      expect(r.midMotion).toBe(true);
      expect(r.nextFrame).toBe(true);
      expect(r.ms).toBeLessThan(50);
    });

    test(`${m}: instant with reduced motion`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await o.fresh(page, live);
      await o.prepare?.(live, page);
      await o.act(page, live);
      await page.waitForFunction(live.after);
      await page.waitForTimeout(100);
      expect(await running(page)).toEqual([]);
    });
  }
}
