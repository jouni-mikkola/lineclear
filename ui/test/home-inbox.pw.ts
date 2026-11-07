// U62: the Inbox strip on Home: what it shows, its choices, and how it leaves.
import { expect, test } from "@playwright/test";
import { open } from "./home-open.ts";

test.use({ timezoneId: "UTC" });

test("the Inbox strip shows only while something waits, with its choices", async ({ page }) => {
  await open(page, "filled");
  const strip = page.locator("[data-inbox-strip]");
  await expect(strip).toBeVisible();
  await expect(strip.getByRole("button").first()).toBeVisible();
  await open(page, "clear");
  await expect(page.locator("[data-inbox-strip]")).toHaveCount(0);
});

test("the strip names the project, the step, who asks and how long ago", async ({ page }) => {
  await open(page, "filled");
  const strip = page.locator("[data-inbox-strip]");
  await expect(strip.locator("[data-inbox-where]")).toContainText("web-shop");
  await expect(strip.locator("[data-inbox-where]")).toContainText("w1 Pay with a saved card");
  await expect(strip.locator("[data-inbox-who]")).toHaveText(/Agent/);
  await expect(strip.locator("[data-inbox-age]")).toContainText("ago");
});

test("the count opens the rest in place, grouped by project", async ({ page }) => {
  await open(page, "many");
  await expect(page.locator("[data-inbox-more]")).toHaveText("+199 more asks");
  await page.locator("[data-inbox-more]").click();
  const groups = page.locator("[data-inbox-group]");
  await expect(groups).toHaveCount(3);
  await groups.first().getByRole("button").first().click();
  await expect(groups.first().locator("[data-inbox-ask]").first()).toBeVisible();
  expect(page.url()).not.toContain("/inbox");
});

test("an answer turns the lamp green, the strip leaves, and Undo brings the ask back", async ({ page }) => {
  await open(page, "filled");
  const live = page.locator('[data-inbox-strip=""]');
  const before = await live.locator("[data-inbox-where]").textContent();
  await live.getByRole("button").first().click();
  await expect(page.locator('[data-inbox-strip="leaving"]')).toHaveAttribute("data-inbox-signal", "clear");
  await expect(page.locator("[data-toast]")).toBeVisible();
  await expect(live.locator("[data-inbox-where]")).not.toHaveText(before ?? "");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator('[data-inbox-strip="leaving"]')).toHaveCount(0);
  await expect(live.locator("[data-inbox-where]")).toHaveText(before ?? "");
});

test("the only ask leaves with its height and nothing is left", async ({ page }) => {
  await open(page, "one");
  const live = page.locator('[data-inbox-strip=""]');
  await live.getByRole("button").first().click();
  await expect(live).toHaveCount(0);
  await expect(page.locator('[data-inbox-strip="leaving"]')).toHaveCount(0, { timeout: 2000 });
});

test("an old /inbox/<ask> link opens /chat on that ask, and the ask is in its task's open row on Home", async ({ page }) => {
  await page.goto("/inbox/w1?state=filled");
  await expect(page).toHaveURL(/\/chat/);
  await expect(page.locator("[data-inbox-strip]").first()).toBeVisible();
  await page.goto("/?state=filled");
  await page.waitForSelector("[data-home]");
  await page.locator("[data-row-id=w1]:visible").first().click();
  await expect(page.locator("[data-row-ask]:visible").first()).toBeVisible();
});
