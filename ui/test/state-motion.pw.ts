// W22: the four state changes of the web pages each play a named kit motion: a route change, a tab switch, a list
// addition and the Dispatcher panel opening. Each stays at 60 fps in a performance trace, plays none under reduced
// motion, and leaves a recording in docs/motion/.
import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { Motion } from "../kit/motion.ts";
import { MOTIONS } from "../kit/motion.ts";
import { press, reread, running, traceMotion } from "./bar.ts";
import { BASE, startFixture, writeTasks } from "./fixture.ts";

const OUT = join(import.meta.dirname, "..", "..", "docs", "motion");

interface Change {
  path: string;
  /** Starts the change. */
  act: (page: Page) => Promise<unknown>;
  /** A JS expression, true once the change shows. */
  after: string;
  /** Sets the change up before the page is told, such as a file written. */
  prepare?: () => void;
  /** Widths it exists at. */
  width?: number;
}

const CHANGES: Partial<Record<Motion, Change>> = {
  "view-change": {
    path: "/settings?state=filled",
    act: (page) => press(page, 'a[aria-label="Lineclear, Home"]:visible'),
    after: `!!document.querySelector('[data-view="home"]')`,
  },
  "tab-change": {
    path: "/task/WEB-3?state=task",
    act: (page) => press(page, "[data-task-tabs] button:nth-child(3)"),
    after: `!!document.querySelector('[data-task-live="changes"]')`,
  },
  "list-add": {
    path: "/",
    prepare: () => writeTasks([...BASE, { id: "WEB-5", title: "Gift cards at checkout", told: "work" }]),
    act: reread,
    after: `!!document.querySelector('[data-row-id="WEB-5"]')`,
  },
  "chat-open": {
    path: "/settings?state=filled",
    act: (page) => press(page, "[data-chat-open]"),
    after: `!!document.querySelector('[data-chat-panel]')`,
    width: 1440,
  },
};

async function fresh(page: Page, c: Change) {
  startFixture();
  // past the server's one second of keeping what it read, before and after the page reads it
  await page.waitForTimeout(1100);
  await page.goto(c.path);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => (document.querySelector("main")?.textContent?.length ?? 0) > 20);
  await page.waitForTimeout(1100);
}

for (const [m, c] of Object.entries(CHANGES) as [Motion, Change][]) {
  test.describe(m, () => {
    test.skip(({ viewport }) => c.width !== undefined && viewport?.width !== c.width, `${m} exists at ${c.width} px only`);

    test("has a motion id in the kit", () => {
      expect(MOTIONS[m].ms).toBeLessThan(300);
    });

    test("plays under its id, and none with reduced motion", async ({ page }) => {
      await fresh(page, c);
      c.prepare?.();
      await c.act(page);
      await page.waitForFunction(c.after);
      await page.waitForFunction((id) => document.getAnimations().some((a) => a.id === id), m, { timeout: 3000 });
      await page.waitForTimeout(MOTIONS[m].ms + 100);

      await page.emulateMedia({ reducedMotion: "reduce" });
      await fresh(page, c);
      c.prepare?.();
      await c.act(page);
      await page.waitForFunction(c.after);
      await page.waitForTimeout(100);
      expect(await running(page)).toEqual([]);
    });

    // frame times read the machine, not only the page: a busy one gets a retry, a real regression fails all three
    test.describe.configure({ retries: 2 });

    test("stays at 60 fps in a performance trace", async ({ page }) => {
      await fresh(page, c);
      c.prepare?.();
      const f = await traceMotion(page, async () => void (await c.act(page)), MOTIONS[m].ms);
      test.info().annotations.push({ type: "frames", description: JSON.stringify(f) });
      expect(await page.evaluate(c.after)).toBe(true);
      expect(f.fps).toBeGreaterThanOrEqual(58);
      expect(f.worstMs).toBeLessThan(34);
      expect(f.longTasks).toEqual([]);
    });

    test("is recorded", async ({ browser, viewport }, info) => {
      test.skip(viewport?.width !== 1440, "recorded once, at 1440 px");
      const size = { width: 1440, height: 900 };
      const context = await browser.newContext({ viewport: size, colorScheme: "dark", recordVideo: { dir: info.outputPath(), size } });
      const page = await context.newPage();
      await fresh(page, c);
      c.prepare?.();
      await c.act(page);
      await page.waitForFunction(c.after);
      await page.waitForTimeout(MOTIONS[m].ms + 400);
      const video = page.video();
      await context.close();
      mkdirSync(OUT, { recursive: true });
      renameSync((await video?.path()) as string, join(OUT, `${m}.webm`));
    });
  });
}
