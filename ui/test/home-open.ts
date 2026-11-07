import type { Page } from "@playwright/test";

/** Opens Home in a demo state and waits until its fonts and motion have settled. */
export async function open(page: Page, state = "filled") {
  await page.goto(`/?state=${state}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("[data-home]");
  await page.waitForTimeout(500);
}
