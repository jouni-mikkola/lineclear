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
  await expect(more).toHaveText(/^\+\d+ more asks?$/);
  // the line's own +N chips say what they hold and where they open
  const chips = page.locator("[data-line] li[title] a");
  expect(await chips.count()).toBeGreaterThan(0);
  for (const chip of await chips.all()) {
    await expect(chip).toHaveAccessibleName(/^\d+ more (in line|at work|in review|ready to merge): open (the Inbox|the roadmap|the first of them)$/);
    await expect(chip).toHaveAttribute("href", /^\/(inbox|task\/.+|.+\/roadmap)$/);
  }
  await expect(line).toHaveScreenshot("home-line-two.png");
});

test("the table keeps a 200-character Last and 200 rows inside its edge, shows no dash, and a phone row leads with its state", async ({ page }) => {
  const now = Date.now();
  const task = (i: number) => ({
    id: `t${i}`,
    title: `S${i} ${"a long title ".repeat(i === 0 ? 20 : 1)}`,
    state: "work",
    stage: "work",
    ...(i === 0 ? {} : { step: `S${i}` }),
    last: { text: "x".repeat(200), at: now - 60_000 },
    // the first row knows nothing of its model and time: the cells stay empty
    ...(i === 0 ? {} : { since: now - 60_000, started: now - 5 * 60_000, model: "vendor-b/a-model-with-a-long-name" }),
  });
  const body = {
    projects: [{ name: "shop", done: 0, total: 200, unit: "steps", broken: false, tasks: Array.from({ length: 200 }, (_, i) => task(i)) }],
    host: "this machine",
  };
  await page.route("**/api/home", (r) => r.fulfill({ json: body }));
  await page.route("**/api/task/*", (r) => r.fulfill({ json: { log: ["a card"], diff: "", review: [] } }));
  await page.goto("/");
  await page.waitForSelector("[data-row-id]:visible");
  await expect(page.locator('[data-table="Working tasks"]')).toHaveAttribute("data-rows", "200");
  const fit = await page.evaluate(() => {
    const visible = (el: Element) => (el as HTMLElement).offsetParent !== null;
    const holders = [...document.querySelectorAll('[data-table="Working tasks"] table, [data-table-cards]')].filter(visible);
    const scroll = holders.map((h) => (h.closest("div,ul") as HTMLElement).scrollWidth - (h.closest("div,ul") as HTMLElement).clientWidth);
    const edge = holders[0]?.closest("div,ul")?.getBoundingClientRect().right ?? 0;
    let past = 0;
    for (const c of document.querySelectorAll('[data-table="Working tasks"] td, [data-table-cards] button *')) {
      if (visible(c)) past = Math.max(past, c.getBoundingClientRect().right - edge);
    }
    const cells = [...document.querySelectorAll('[data-table="Working tasks"] td, [data-table-cards] button')]
      .filter(visible)
      .map((c) => c.textContent?.trim());
    return {
      scroll,
      past,
      dash: cells.filter((t) => t === "-" || /(^|\s)-($|\s)/.test(t ?? "")).length,
    };
  });
  expect(fit.scroll.every((s) => s <= 0)).toBe(true);
  expect(fit.past).toBeLessThanOrEqual(0);
  expect(fit.dash).toBe(0);
  const phone = (page.viewportSize()?.width ?? 0) < 640;
  const row = page.locator(phone ? "[data-table-cards] [data-row-id]:visible" : "tr[data-row-id]:visible");
  // the first row knows no model or time: nothing stands in for them; the next shows both
  await expect(row.nth(1)).toContainText("vendor-b/");
  await expect(row.nth(1)).toContainText("5 min");
  if (phone) await expect(row.nth(1).locator("button")).toHaveText(/^at work/);
  // the 200-character Last ends in an ellipsis in its cell
  if (!phone) {
    const cut = await row
      .nth(1)
      .locator("td")
      .nth(4)
      .locator("span")
      .first()
      .evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(cut).toBe(true);
    // the cut cell holds the whole text in its title
    await expect(row.nth(1).locator("td").nth(4).locator("span").first()).toHaveAttribute("title", new RegExp(`^${"x".repeat(200)}`));
  }
  // the open row reads it in full
  await row.nth(1).click();
  await expect(page.locator("[data-in-full]:visible")).toContainText("x".repeat(200));
  await expect(page.locator("[data-in-full]:visible")).toContainText("vendor-b/a-model-with-a-long-name");
});

test("W14: on a phone the table head says Sort by and the first row starts above 700 px", async ({ page }) => {
  if ((page.viewportSize()?.width ?? 0) >= 640) return;
  await open(page, "many");
  const bar = page.getByRole("group", { name: "Sort Working tasks" });
  await expect(bar).toContainText("Sort by");
  await expect(bar.getByRole("combobox")).toBeVisible();
  const y = (await page.locator("[data-table-cards] [data-row-id]:visible").first().boundingBox())?.y ?? Number.POSITIVE_INFINITY;
  expect(y).toBeLessThan(700);
  await page.screenshot({ path: "ui/test/screens/home-many-sort-390.png" });
});
