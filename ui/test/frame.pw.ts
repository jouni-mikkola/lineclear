// The frame: the rail from 1024 px, the bottom bar under it, one address for each view, project, step and ask.
import { expect, type Page, test } from "@playwright/test";
import { startFixture, writeItem, writeShopRoadmap, writeThisRoadmap } from "./fixture.ts";

test.use({ timezoneId: "UTC" });

const VIEWS = ["/", "/settings", "/web-shop/roadmap", "/web-shop/roadmap/W1"];

test("every view in the board's frame, at this width", async ({ page }) => {
  for (const path of VIEWS) {
    await page.goto(`${path}?state=filled`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot(`frame${path.replace(/\//g, "-") || "-home"}.png`, { fullPage: true });
  }
});

test("the frame holds the grid: a rail from 1024 px, content up to 1128 px in the room beside it, a bar under 1024 px", async ({ page, viewport }) => {
  const wide = (viewport?.width ?? 0) >= 1024;
  // Home fills the window with its own columns; the grid is held by every other view
  await page.goto("/settings?state=filled");
  await page.evaluate(() => document.fonts.ready);
  const rail = page.locator('nav[aria-label="Views"]:visible');
  await expect(rail).toHaveCount(1);
  await expect(page.locator("div.fixed[data-bar]:visible")).toHaveCount(wide ? 0 : 1);
  const main = await page.locator("[data-content]").boundingBox();
  if (!main || !viewport) throw new Error("the content has no box");
  expect(main.width).toBeLessThanOrEqual(1128 + 1);
  if (wide) {
    const r = await rail.boundingBox();
    if (!r) throw new Error("the rail has no box");
    expect(r.x).toBe(0);
    // centred in the room right of the rail
    const left = main.x - (r.x + r.width);
    const aside = page.locator("aside:visible");
    const panel = (await aside.count()) ? await aside.first().boundingBox() : null;
    const right = (panel ? panel.x : viewport.width) - (main.x + main.width);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(2);
  }
});

async function cold(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
}

test("each address opens cold and after a reload on the same thing", async ({ page }) => {
  startFixture();
  writeShopRoadmap();
  writeThisRoadmap();
  // the roadmaps replace the task list: the ask belongs to a task that is in it
  writeItem(1, { task: "WEB-3", question: "Pay with a saved card needs a payment provider. Which one?", choices: ["Stripe", "Adyen"] });
  await page.waitForTimeout(1100);
  await page.request.get("/api/roadmap/web-shop");
  await page.waitForTimeout(1100);
  const places: { path: string; show: string }[] = [
    { path: "/", show: '[data-view="home"]' },
    { path: "/inbox", show: '[data-view="home"]' },
    { path: "/chat", show: `[data-view="chat"]` },
    { path: "/usage", show: `[data-view="usage"]` },
    { path: "/browsers", show: `[data-view="browsers"]` },
    { path: "/settings", show: '[data-view="settings"]' },
    { path: "/web-shop/roadmap/track", show: "[data-step]" },
    { path: "/web-shop/roadmap/W1", show: "[data-step-page]" },
  ];
  for (const { path, show } of places) {
    // the server answers with what it last read while it reads again: a cold open that finds it stale tries again
    await expect(async () => {
      await cold(page, path);
      await expect(page.locator(show).first(), `${path} cold`).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe(path === "/inbox" ? "/" : path);
    await page.reload();
    await expect(page.locator(show).first(), `${path} reloaded`).toBeVisible({ timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe(path === "/inbox" ? "/" : path);
  }
});
