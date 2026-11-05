// U37: every view with a malformed roadmap file and with a roadmap of 1000 steps shows its designed state (U34, U29).
import { expect, type Page, test } from "@playwright/test";
import { breakRoadmap, startBrowsers, writeBigRoadmap } from "./fixture.ts";
import { open, VIEWS } from "./open.ts";
import { everyView, noticed, whole } from "./trouble.ts";

test.use({ timezoneId: "UTC" });

test("a malformed roadmap file: the roadmap says so and every other view stays whole", async ({ page, context }) => {
  await open(page, "/web-shop/roadmap/track", "Stock alerts by mail");
  await breakRoadmap(page, "## P\n\n### X1 Half a step\n- why: w\n- done when: d\n");
  const pages = await everyView(context, page);
  await noticed([pages[VIEWS.indexOf("/web-shop/roadmap")] as Page], "broken");
  await Promise.all(pages.map((p, i) => whole(p, VIEWS[i] as string)));
});

test("a roadmap of 1000 steps: every view stays whole", async ({ page, context }) => {
  startBrowsers();
  writeBigRoadmap(1000);
  await page.waitForTimeout(1100);
  await expect.poll(async () => (await page.request.get("/api/roadmap/web-shop")).text(), { timeout: 20_000 }).toContain("Step number 999");
  const pages = await everyView(context, page);
  await expect((pages[VIEWS.indexOf("/web-shop/roadmap")] as Page).locator("[data-goal], [data-step], [data-station]").first()).toBeVisible();
  await Promise.all(pages.map((p, i) => whole(p, VIEWS[i] as string)));
});
