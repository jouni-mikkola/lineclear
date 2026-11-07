// The UI bar on a task's chat (`/task/<id>`), served by `lineclear run`. The pictures use the sample states (`?state=`).
import { expect, test } from "@playwright/test";
import { PAGE_STATES } from "./bar.ts";

const TASK_STATES = [...PAGE_STATES, "sending", "offline", "none", "task"];

test("a task's chat in every state, at this width", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const state of TASK_STATES) {
    await page.goto(`/task/WEB-3?state=${state}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector("[data-chat], [data-notice], [role=alert]");
    await page.evaluate(() =>
      Promise.all(
        [...document.images].map((i) => {
          i.loading = "eager";
          return i.decode().catch(() => {});
        }),
      ),
    );
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.addStyleTag({ content: "[data-composer-bar] { position: static !important }" });
    await expect(page).toHaveScreenshot(`task-chat-${state}.png`, { fullPage: true });
  }
});

test("a task's chat shows a reply, a plan's steps and its own head", async ({ page }) => {
  await page.goto("/task/WEB-3?state=task");
  await page.waitForSelector("[data-thread]");
  await expect(page.locator("[data-task-head]")).toContainText("WEB-3");
  await expect(page.locator("[data-quote]")).toBeVisible();
  await expect(page.locator("[data-plan-steps] li")).toHaveCount(3);
  await page.locator("[data-reply]").first().click();
  await expect(page.locator("[data-replying]")).toBeVisible();
});
