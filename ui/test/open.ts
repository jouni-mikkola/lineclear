// Opening a view on the test files, and watching a page for what must never happen on it.
import { expect, type Page } from "@playwright/test";
import { startBrowsers, writeShopRoadmap } from "./fixture.ts";

/** Writes the files, and returns once the server has read them: the page opened next finds them. */
async function prepare(page: Page) {
  startBrowsers();
  writeShopRoadmap();
  // the clock stands at 14:02, so the pictures say the same time on every run
  await page.clock.setFixedTime(new Date("2026-10-31T14:02:00Z"));
  // the server answers with what it last read while it reads again: past this read, the page finds the new files
  await page.waitForTimeout(1100);
  // the server may still answer with the files of the test before, so ask until it has read the new ones
  const answers = async (api: string) => (await page.request.get(api)).text();
  await expect.poll(() => answers("/api/roadmap/web-shop"), { timeout: 20_000 }).toContain("Stock alerts by mail");
  // a rule tick between the clearing and the writing of the files closes the items as the task of them is gone: write them again
  await expect
    .poll(
      async () => {
        const inbox = await answers("/api/inbox");
        if (!inbox.includes("Pay with a saved card")) startBrowsers();
        return inbox;
      },
      { timeout: 20_000 },
    )
    .toContain("Pay with a saved card");
  await page.waitForTimeout(1100);
}

/** Opens a path and waits until no part of it is loading. */
async function show(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  // the Dispatcher's chat beside Home keeps connecting in this fixture, which has no Dispatcher
  await expect(page.locator("[data-part-state=loading]:not([data-chat-column] *)")).toHaveCount(0, { timeout: 15_000 });
}

export async function open(page: Page, path: string, marker = "") {
  await prepare(page);
  await show(page, path);
  if (marker) await expect(page.locator("[data-view]")).toContainText(marker);
}

export { reread } from "./bar.ts";
