// Shared by the specs of U37: every view opened under a lost connection, a stopped service, a slow API, a malformed roadmap file and a
// roadmap of 1000 steps shows its designed state (U34, U29): no uncaught error, no blank view, no sideways scrolling.
import { type BrowserContext, expect, type Page } from "@playwright/test";
import { reread, show, VIEWS } from "./open.ts";

const THROWN = new WeakMap<Page, string[]>();

/** One page per view, all shown and loaded, so a trouble reaches every view at once. */
export async function everyView(context: BrowserContext, first: Page): Promise<Page[]> {
  // an open stream of changes outlives the refused calls, and a view on it never reads again
  await context.route("**/api/live**", (r) => r.abort());
  const pages = [first, ...(await Promise.all(VIEWS.slice(1).map(() => context.newPage())))];
  await Promise.all(
    pages.map(async (page, i) => {
      const thrown: string[] = [];
      THROWN.set(page, thrown);
      page.on("pageerror", (e) => thrown.push(e.message));
      await show(page, VIEWS[i] as string);
    }),
  );
  return pages;
}

/** The view is whole: something on it, nothing thrown, nothing wider than the screen. */
export async function whole(page: Page, path: string) {
  await expect(page.locator("[data-view]"), `${path} is blank`).not.toHaveText("");
  expect(THROWN.get(page), `${path} threw`).toEqual([]);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(wide, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
}

export const noticed = (pages: Page[], kind: string) =>
  Promise.all(
    pages.map(async (page, i) => {
      await expect(async () => {
        await reread(page);
        await expect(page.locator(`[data-notice=${kind}]`), `${VIEWS[i]} has no ${kind} notice`).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 15_000 });
      await whole(page, VIEWS[i] as string);
    }),
  );
