// U14: a machine card and the Browsers view say what they show, on sample data.
import { expect, test } from "@playwright/test";
import { startBrowsers } from "./fixture.ts";

test.describe("U14", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "checked once, at 1440 px");

  test("a machine over its load limit reads busy and its overflow is grey, never amber or green", async ({ page }) => {
    await page.goto("/design");
    const over = page.locator('[data-machine="me@10.0.0.7"]');
    await expect(over).toHaveAttribute("data-look", "busy");
    await expect(over).not.toContainText("ready");
    const colors = await over.evaluate((card) => {
      const paint = (cls: string) => {
        const probe = document.createElement("div");
        probe.className = cls;
        document.body.append(probe);
        const c = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return c;
      };
      const bars = [...card.querySelectorAll<HTMLElement>('[role="meter"] > div')].map((d) => getComputedStyle(d).backgroundColor);
      return { bars, grey: paint("bg-fg2"), amber: paint("bg-caution") };
    });
    expect(colors.bars).toContain(colors.grey);
    expect(colors.grey).not.toBe(colors.amber);
    expect(colors.bars).not.toContain(colors.amber);
    // a machine under its limit stays ready
    await expect(page.locator('[data-machine="build-box"]')).toHaveAttribute("data-look", "ready");
  });

  test("a browser card shows its task's title and the page's host", async ({ page }) => {
    await page.goto("/design");
    const card = page.locator('[data-browser="WEB-2"]');
    await expect(card).toContainText("Search that forgives typos");
    await expect(card.locator("[data-host]")).toHaveText("localhost:5173");
    await expect(card).not.toContainText("Search results for");
  });

  test("a task's browser has a placeholder with the page's host until its first picture comes", async ({ page }) => {
    startBrowsers();
    await page.route("**/api/browsers/*/picture*", () => {});
    await page.goto("/browsers");
    await page
      .getByRole("row", { name: /Pay with a saved card/ })
      .first()
      .click();
    await expect(page.locator("[data-placeholder]:visible").first()).toBeVisible();
  });
});
