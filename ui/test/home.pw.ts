// U62: Home is one page that fills the window: the line, the Inbox strip when something waits, the table of working
// tasks, the Dispatcher's chat and the usage mark. It explains nothing and counts nothing in a headline.
import { expect, test } from "@playwright/test";
import { open } from "./home-open.ts";

test.use({ timezoneId: "UTC" });

test("Home has no page scroll from 1024 px and keeps its parts in the window", async ({ page, viewport }) => {
  await open(page);
  if ((viewport?.width ?? 0) < 1024) return;
  const over = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  expect(over).toBeLessThanOrEqual(0);
  for (const sel of ["[data-line]", '[data-table="Working tasks"]', "[data-chat-column]", "[data-usage-mark]"]) {
    const b = await page.locator(sel).first().boundingBox();
    expect((b?.y ?? Number.POSITIVE_INFINITY) + (b?.height ?? 0), sel).toBeLessThanOrEqual((viewport?.height ?? 0) + 1);
  }
});

test("Home has no subtitle, hint, section label, headline or counts line", async ({ page }) => {
  await open(page);
  // the chat holds what people wrote and the line draws its own labels; a headline would sit in the center column outside them
  const text = await page
    .locator("[data-home] > div")
    .first()
    .evaluate((el) => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.querySelector("[data-line]")?.remove();
      return copy.textContent ?? "";
    });
  for (const gone of ["The line", "Projects", "Other work", "Spend, last 14 days", "Usage, this session and week", "Compaction, last 14 days"]) {
    await expect(page.getByRole("heading", { name: gone, exact: true })).toHaveCount(0);
  }
  // the only headings are the screen-reader h1, the Dispatcher's name and the chat's thread
  const heads = await page.$$eval("[data-home] h1, [data-home] h2, [data-home] h3", (els) => els.map((e) => e.textContent));
  expect(heads.filter((h) => h !== "Home" && h !== "Dispatcher" && h !== "Messages")).toEqual([]);
  // no spend figure, spend chart or per-account bar row on the page itself
  expect(text).not.toMatch(/\$\d/);
  await expect(page.locator("[data-limit]")).toHaveCount(0);
  await expect(page.locator("[data-engines]")).toHaveCount(0);
  // no headline that counts: "3 tasks wait for you"
  expect(text).not.toMatch(/\b\d+ (tasks?|steps?|projects?) (wait|work|run|merged)/i);
});

test("the table lists the working tasks and a row opens in place", async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-table="Working tasks"]')).toBeVisible();
  await page.locator("[data-row-id]:visible").first().click();
  const details = page.locator("[data-task-details]:visible").first();
  await expect(details).toBeVisible();
  await expect(details).toContainText("Log");
  await expect(details.locator("[data-cost]")).toBeVisible();
});

test("the usage mark opens the sheet, and /usage opens it too", async ({ page }) => {
  await open(page);
  await page.locator("[data-usage-mark]").click();
  await expect(page.locator("[data-usage-sheet]")).toBeVisible();
  await expect(page.locator("[data-per-step]")).toBeVisible();
  await page.goto("/usage?state=filled");
  await expect(page.locator("[data-usage-sheet]")).toBeVisible();
});

test("Home draws every state without breaking", async ({ page }) => {
  for (const state of ["empty", "loading", "error", "long", "many"]) {
    await page.goto(`/?state=${state}`);
    await page.waitForTimeout(400);
    await expect(page.locator("body")).not.toContainText("Something went wrong");
  }
});

test("Home at this width", async ({ page }) => {
  await open(page);
  await expect(page).toHaveScreenshot("home-command.png");
});

test("the line shows every project to its main end, and +N names what it opens", async ({ page }) => {
  await open(page);
  await page.waitForSelector("[data-line] [data-track]");
  const line = page.locator("section[data-line]");
  const tracks = await page.locator("[data-line] [data-track]").count();
  expect(tracks).toBeGreaterThanOrEqual(2);
  // nothing of the line is cut off below, and no part of it runs past the right edge of its region
  const fit = await line.evaluate((el) => {
    const box = el.getBoundingClientRect();
    let right = 0;
    for (const e of el.querySelectorAll("[data-line] *")) {
      const b = e.getBoundingClientRect();
      if (b.width > 0 && getComputedStyle(e).visibility !== "hidden") right = Math.max(right, b.right);
    }
    const lastTrack = [...el.querySelectorAll("[data-track]")].at(-1)?.getBoundingClientRect().bottom ?? 0;
    return { hidden: el.scrollHeight - el.clientHeight, right: right - box.right, lastTrack: lastTrack - box.bottom };
  });
  expect(fit.hidden).toBeLessThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(0);
  expect(fit.lastTrack).toBeLessThanOrEqual(0);
  const more = page.locator("[data-inbox-more]");
  await expect(more).toHaveAccessibleName(/^Show \d+ more asks?$/);
  await expect(line).toHaveScreenshot("home-line-two.png");
});
