// The UI bar on a task's terminal, artifacts and changes (`/task/<id>?tab=`), served by `lineclear run`. The pictures use the
// sample states (`?state=`).
import { expect, type Page, test } from "@playwright/test";
import { PAGE_STATES } from "./bar.ts";

// the search loads after the page, so the key is pressed until its box is there
const openSearch = async (page: Page) => {
  const box = page.getByLabel("Search tasks, chats and steps");
  await expect(async () => {
    await page.keyboard.press("/");
    await expect(box).toBeVisible({ timeout: 300 });
  }).toPass();
  return box;
};

for (const tab of ["terminal", "artifacts", "changes"]) {
  test(`a task's ${tab} in every state, at this width`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const state of PAGE_STATES) {
      await page.goto(`/task/WEB-3?tab=${tab}&state=${state}`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForSelector("[data-task-live]");
      await expect(page).toHaveScreenshot(`task-${tab}-${state}.png`, { fullPage: true });
    }
  });
}

test("the terminal takes words and keys, and the tab stays in the address", async ({ page }) => {
  await page.goto("/task/WEB-3?state=filled");
  await page.getByRole("button", { name: "Terminal" }).click();
  await expect(page).toHaveURL(/tab=terminal/);
  await expect(page.locator("[data-terminal-screen]")).toContainText("bun test");
  await page.getByLabel("Type into the terminal").fill("yes");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByLabel("Type into the terminal")).toHaveValue("");
  await page.getByRole("button", { name: "Esc" }).click();
  await page.getByRole("button", { name: "Chat" }).click();
  await expect(page).not.toHaveURL(/tab=/);
});

test("an artifact opens full screen in a sealed frame and closes", async ({ page }) => {
  await page.goto("/task/WEB-3?tab=artifacts&state=filled");
  await page.locator("[data-artifact]").first().click();
  const frame = page.locator("[data-artifact-full] iframe");
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-forms");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(frame).toHaveCount(0);
});

test("the changes open file by file and link to the pull request", async ({ page }) => {
  await page.goto("/task/WEB-3?tab=changes&state=filled");
  await expect(page.locator("[data-pr]")).toHaveAttribute("href", /pull\/52$/);
  const second = page.locator("[data-diff-file]").nth(1);
  await expect(second).not.toHaveAttribute("open", "");
  await second.locator("summary").click();
  await expect(second).toContainText("Math.round");
});

test("keys pick a task's tab and / opens the search", async ({ page }) => {
  await page.goto("/task/WEB-3?state=filled");
  await page.waitForSelector("[data-task-tabs]");
  await expect(async () => {
    await page.keyboard.press("4");
    await expect(page).toHaveURL(/tab=changes/, { timeout: 300 });
  }).toPass();
  await page.keyboard.press("1");
  await expect(page).not.toHaveURL(/tab=/);
  await (await openSearch(page)).fill("cart");
  await expect(page.locator("[data-hit]")).toHaveCount(3);
  await page.locator('[data-hit="step"]').click();
  await expect(page).toHaveURL(/web-shop\/roadmap\/W4/);
});

test("the search says when it finds nothing and when it fails", async ({ page }) => {
  for (const [state, text] of [
    ["empty", "Nothing found"],
    ["error", "did not answer"],
  ]) {
    await page.goto(`/task/WEB-3?state=${state}`);
    await (await openSearch(page)).fill("cart");
    await expect(page.locator("[data-search]")).toContainText(text as string);
  }
});

test("a tab pick and the search fade in, and nothing moves under reduced motion", async ({ page }) => {
  await page.goto("/task/WEB-3?state=filled");
  await page.waitForSelector("[data-task-tabs]");
  await page.evaluate(() => {
    const w = window as unknown as { __fades: string[] };
    w.__fades = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (k, o) {
      w.__fades.push(`${(o as KeyframeAnimationOptions).id}:${(this as HTMLElement).dataset.taskLive ?? (this as HTMLElement).dataset.search ?? ""}`);
      return animate.call(this, k, o);
    };
  });
  await page.keyboard.press("2");
  await expect(page.locator("[data-task-live]")).toBeVisible();
  await openSearch(page);
  const seen = await page.evaluate(() => (window as unknown as { __fades: string[] }).__fades);
  expect(seen.some((s) => s.startsWith("part-change:terminal"))).toBe(true);
  expect(seen.join()).toContain("part-change:idle");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const before = seen.length;
  await page.keyboard.press("Escape");
  await page.keyboard.press("3");
  await expect(page.locator('[data-task-live="artifacts"]')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __fades: string[] }).__fades.length)).toBe(before);
});
