// The states the demo reaches (`?state=`): a 200-character title, 200 tasks in one project, and a task with a chat and its changes, at both widths.
import { expect, test } from "@playwright/test";
import { open } from "./home-open.ts";

const noBottomBar = (page: import("@playwright/test").Page) => page.addStyleTag({ content: "nav[aria-label=Views] { position: static !important }" });

test("Home with a 200-character title", async ({ page }) => {
  await open(page, "title");
  await expect(page.locator("[title*='tell the shopper']").first()).toBeAttached();
  await noBottomBar(page);
  await expect(page).toHaveScreenshot("demo-home-title.png", { fullPage: true });
});

test("Home with 200 tasks in one project", async ({ page }) => {
  await open(page, "tasks200");
  await expect(page.locator("body")).not.toContainText("Something went wrong");
  await noBottomBar(page);
  await expect(page).toHaveScreenshot("demo-home-tasks200.png", { fullPage: true });
});

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
