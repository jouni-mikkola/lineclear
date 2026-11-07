// The chat beside a view: a 400 px panel on a desktop, open for good from 1920 px, and none on a phone.
import { expect, test } from "@playwright/test";

test.describe("panel", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "the panel is checked at its own widths, from the 1440 run");

  test("opens by its button at 1440 px, 400 px wide, and closes", async ({ page }) => {
    await page.goto("/settings?state=filled");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("[data-chat-panel]")).toHaveCount(0);
    await page.locator("[data-chat-open]").click();
    const panel = page.locator("[data-chat-panel]");
    await expect(panel).toBeVisible();
    expect((await panel.boundingBox())?.width).toBe(400);
    await expect(page.locator("[data-chat-panel] [data-composer]")).toBeInViewport();
    // the view makes room: its content ends where the panel starts
    const content = await page.locator("[data-content]").boundingBox();
    if (!content) throw new Error("the content has no box");
    expect(content.x + content.width).toBeLessThanOrEqual(1040);
    await expect(page).toHaveScreenshot("panel-1440.png");
    await page.locator("[data-chat-close]").click();
    await expect(panel).toHaveCount(0);
  });

  for (const width of [1920, 2560]) {
    test(`stays open at ${width} px, with no close`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 });
      await page.goto("/web-shop/roadmap?state=filled");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("[data-chat-panel]")).toBeVisible();
      await expect(page.locator("[data-chat-close]")).toHaveCount(0);
      // the thread scrolls to its end as it loads: shoot once it has
      await page.waitForTimeout(500);
      await expect(page).toHaveScreenshot(`panel-${width}.png`);
    });
  }

  test("Home has no panel: its chat is its own", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1200 });
    await page.goto("/?state=filled");
    await expect(page.locator("[data-chat-panel]")).toHaveCount(0);
    await expect(page.locator("[data-chat-open]")).toHaveCount(0);
  });

  test("with no Dispatcher one screen gives the command and copies it", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/chat?state=none");
    await expect(page.locator("[data-setup-command]")).toHaveText("lineclear dispatcher setup");
    await page.locator("[data-copy]").click();
    await expect(page.locator("[data-copy]")).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("lineclear dispatcher setup");
  });
});

test("on a phone there is no panel and no open button", async ({ page, viewport }) => {
  test.skip(viewport?.width !== 390, "a phone only");
  await page.goto("/settings?state=filled");
  await expect(page.locator("[data-chat-panel]")).toBeHidden();
  await expect(page.locator("[data-chat-open]")).toBeHidden();
});
