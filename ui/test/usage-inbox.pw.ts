// U17 on sample data: the usage card shows what its title says and is on Home only, each spend bar names its day
// and dollars on hover, focus and tap.
import { expect, test } from "@playwright/test";

test("the usage card's title and bars name the same span, a session and a week, each with its reset", async ({ page }) => {
  await page.goto("/usage?state=filled");
  const card = page.locator("[data-usage-sheet] [data-engines]");
  const full = card.locator('[data-engine="work-subscription"]');
  await expect(full.locator('[data-limit="session"]')).toContainText("100%");
  await expect(full.locator('[data-limit="session"]')).toContainText("full, frees in 1 h");
  await expect(full.locator('[data-limit="week"]')).toContainText("81%");
  await expect(card.locator('[data-engine="home-subscription"] [data-limit="session"] [role="progressbar"]')).toHaveAttribute("aria-valuenow", "42");
  await expect(card.locator('li[data-engine="api-key"]')).toContainText("no limit reported");
  await expect(card.locator('li[data-engine="api-key"] [data-limit]')).toHaveCount(0);
});

test("Settings shows no usage: it is on Home only", async ({ page }) => {
  await page.goto("/settings?state=filled");
  await page.waitForSelector("[data-settings]");
  await expect(page.locator("[data-engines]")).toHaveCount(0);
  await expect(page.locator("main").getByText(/^Usage/)).toHaveCount(0);
});

test("each spend bar names its day and its dollars on hover, focus and tap", async ({ page }, info) => {
  await page.goto("/usage?state=filled");
  const tip = page.locator("[data-tip]");
  const bar = (day: string) => page.locator(`[data-day="${day}"]`);
  await bar("2026-01-10").hover();
  await expect(tip).toHaveText("Jan 10: $12.10");
  await page.mouse.move(0, 0);
  await expect(tip).toHaveCount(0);
  // by keyboard the bars are one stop, so each bar is not a target too small to press: arrows walk the days
  const bars = page.locator("[data-spend-bars]");
  await bars.focus();
  await expect(tip).toHaveText("Today, Jan 14: $7.35");
  await expect(bars).toHaveAttribute("aria-describedby", "spend-tip");
  await page.keyboard.press("Home");
  await expect(tip).toHaveText(/^Jan 1: \$/);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(tip).toHaveText("Jan 3: $3.30");
  await bars.blur();
  await expect(tip).toHaveCount(0);
  if (info.project.name === "390") await bar("2026-01-14").tap();
  else await bar("2026-01-14").click();
  await expect(tip).toHaveText("Today, Jan 14: $7.35");
  // the tip of an edge bar stays on screen
  const box = (await tip.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await bars.focus();
  await page.keyboard.press("Home");
  const first = (await tip.boundingBox())!;
  expect(first.x).toBeGreaterThanOrEqual(0);
});
