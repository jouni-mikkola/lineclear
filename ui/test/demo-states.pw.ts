// W10: the states the demo must reach (a long title, 200 tasks in one project, a task with chat and changes), shot at both widths.
import { expect, test } from "@playwright/test";
import { open } from "./home-open.ts";

for (const state of ["title", "tasks200"]) {
  test(`Home with ${state === "title" ? "a 200-character title" : "200 tasks in one project"}`, async ({ page }) => {
    await open(page, state);
    if (state === "title") await expect(page.locator("[title*='tell the shopper']").first()).toBeAttached();
    await expect(page.locator("body")).not.toContainText("Something went wrong");
    await expect(page).toHaveScreenshot(`demo-home-${state}.png`, { fullPage: true });
  });
}

test("a task page with a chat and a change", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/task/WEB-3?state=task");
  await page.waitForSelector("[data-thread]");
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot("demo-task-chat.png", { fullPage: true });
  await page.goto("/task/WEB-3?tab=changes&state=task");
  await page.waitForSelector("text=src/cart/total-1.ts");
  await expect(page).toHaveScreenshot("demo-task-changes.png", { fullPage: true });
});
