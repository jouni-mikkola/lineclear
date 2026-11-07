// The UI bar on a task page's one header (`/task/<id>`), served by `lineclear run`. The pictures use the sample states (`?state=`).
import { expect, test } from "@playwright/test";

test("one header: the title, the state, the step and the model, with the tabs beneath at the content edge", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/task/WEB-3?state=task");
  await page.waitForSelector("[data-thread]");
  const head = page.locator("[data-task-head]");
  await expect(head).toHaveCount(1);
  await expect(head.locator("h1")).toContainText("WEB-3 W3 Totals follow the removed line");
  await expect(head.locator("[data-task-facts]")).toContainText("in review · W3 · vendor-b/model-review");
  const title = (await head.locator("h1").boundingBox())!;
  const first = (await page.locator("[data-task-tabs] button").first().boundingBox())!;
  const label = await page
    .locator("[data-task-tabs] button")
    .first()
    .evaluate((b) => {
      const r = document.createRange();
      r.selectNodeContents(b);
      return r.getBoundingClientRect().left;
    });
  expect(Math.abs(label - title.x)).toBeLessThan(2);
  expect(first.y).toBeGreaterThan(title.y + title.height);
  await expect(page).toHaveScreenshot("task-header.png", { fullPage: true });
});

test("an id nothing has shows not found with a way Home", async ({ page }) => {
  await page.goto("/task/NOPE-9?state=filled");
  await expect(page.locator("[data-task-missing=NOPE-9]")).toBeVisible();
  await expect(page.locator("[data-composer]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Home" }).first()).toHaveAttribute("href", "/");
  await expect(page).toHaveScreenshot("task-missing.png", { fullPage: true });
});

test("a task with no chat says so once and its composer is off", async ({ page }) => {
  await page.goto("/task/WEB-3?state=none");
  await page.waitForSelector("[data-task-note]");
  await expect(page.getByText(/no chat/i)).toHaveCount(1);
  await expect(page.locator("[data-message-box]")).toBeDisabled();
  await expect(page.locator("[data-send]")).toBeDisabled();
  await expect(page).toHaveScreenshot("task-no-chat.png", { fullPage: true });
});
