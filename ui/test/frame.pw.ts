// W6: the frame leads to every view. The rail (from 1024 px) and the bottom bar list Home, Inbox, Browsers and Settings with
// icons, `aria-current` and 44 px targets, and the Inbox carries the count.
import { expect, type Page, test } from "@playwright/test";

const VIEWS = ["Home", "Inbox", "Browsers", "Settings"] as const;
const PATH: Record<(typeof VIEWS)[number], string> = { Home: "/", Inbox: "/inbox", Browsers: "/browsers", Settings: "/settings" };

async function open(page: Page, path: string, state = "filled") {
  await page.goto(`${path}?state=${state}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('nav[aria-label="Views"] a:visible');
}

const nav = (page: Page) => page.locator('nav[aria-label="Views"]:visible').first();

test("the navigation lists the four views, each with an icon and a 44 px target", async ({ page }) => {
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

test("the Inbox carries the count of what waits, and no other view does", async ({ page }) => {
  await open(page, "/settings");
  const badges = nav(page).locator("[data-badge]");
  await expect(badges).toHaveCount(1);
  await expect(nav(page).locator('a[href="/inbox"] [data-badge]')).toHaveCount(1);
  await expect(badges).toHaveText(/^\d+/);
});

test("/inbox with no ask shows an Inbox view", async ({ page }) => {
  await open(page, "/inbox", "empty");
  await expect(page.locator('[data-view="inbox"]')).toBeVisible();
  await expect(page.locator("[data-inbox-empty]")).toBeVisible();
  await expect(page).toHaveURL(/\/inbox/);
  await expect(nav(page).locator("[data-badge]")).toHaveCount(0);
});

test("/inbox with asks shows the first one", async ({ page }) => {
  await open(page, "/inbox");
  await expect(page.locator('[data-view="inbox"]')).toBeVisible();
  await expect(page.locator("[data-inbox-empty]")).toHaveCount(0);
});

test("no part of the page scrolls sideways", async ({ page }) => {
  for (const name of VIEWS) {
    await open(page, PATH[name]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
