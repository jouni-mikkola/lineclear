// W6: the frame leads to every view. The rail (from 1024 px) and the bottom bar list Home, Browsers and Settings with
// icons, `aria-current` and 44 px targets.
import { expect, type Page, test } from "@playwright/test";

const VIEWS = ["Home", "Browsers", "Settings"] as const;
const PATH: Record<(typeof VIEWS)[number], string> = { Home: "/", Browsers: "/browsers", Settings: "/settings" };

async function open(page: Page, path: string, state = "filled") {
  await page.goto(`${path}?state=${state}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('nav[aria-label="Views"] a:visible');
}

const nav = (page: Page) => page.locator('nav[aria-label="Views"]:visible').first();

test("the navigation lists the three views, each with an icon and a 44 px target", async ({ page }) => {
  await open(page, "/settings");
  const links = nav(page).locator("a[data-block]:not([aria-label='Lineclear, Home'])");
  for (const name of VIEWS) {
    const link = links.filter({ hasText: name });
    await expect(link).toHaveAttribute("href", PATH[name]);
    await expect(link.locator("svg")).toHaveCount(1);
    const box = await link.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
});

test("the view you are on is marked with aria-current", async ({ page }) => {
  for (const name of VIEWS) {
    await open(page, PATH[name]);
    await expect(nav(page).locator('[aria-current="page"]')).toHaveText(new RegExp(`^${name}`));
  }
});

test("/inbox opens /chat", async ({ page }) => {
  await open(page, "/inbox", "empty");
  await expect(page).toHaveURL(/\/chat/);
  await expect(page.locator('[data-view="inbox"]')).toHaveCount(0);
});

test("no part of the page scrolls sideways", async ({ page }) => {
  for (const name of VIEWS) {
    await open(page, PATH[name]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
