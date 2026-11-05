// U37: the roadmap line equals what the CLI prints, and no overview carries a call-out headline.
import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { FIXTURE } from "./fixture.ts";
import { cli, open } from "./open.ts";
import { phrases } from "./numbers.ts";

test.use({ timezoneId: "UTC" });

test("the roadmap line is the line the CLI prints", async ({ page }) => {
  await open(page, "/web-shop/roadmap/track", "Pay with a saved card");
  const first = cli("roadmap", "status", join(FIXTURE, "repos", "web-shop"), "--space", "web-shop").split("\n")[0];
  await expect(page.locator("[data-roadmap-line]")).toHaveText(first as string);
});

test("Home, Usage and the roadmap carry no call-out headline", async ({ page }) => {
  const list = phrases();
  expect(list.length).toBeGreaterThan(3);
  await open(page, "/");
  for (const path of ["/", "/usage", "/web-shop/roadmap"]) {
    await page.goto(path);
    // under /usage Home's chat part stays on its loading picture (reported on the task, a product matter)
    await expect(page.locator('[data-part-state=loading]:not([data-part="The chat"])')).toHaveCount(0, { timeout: 15_000 });
    const text = ((await page.locator("body").textContent()) ?? "").toLowerCase();
    for (const phrase of list) expect(text, `${path} says "${phrase}"`).not.toContain(phrase.toLowerCase());
  }
});
