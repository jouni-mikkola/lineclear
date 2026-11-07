// The chain of a step as rail: the steps before and after it, the critical path marked on the rail and in words, and
// one tap from the roadmap's line. test/roadmap.test.ts finds the same path in `lineclear roadmap status`.
import { expect, test } from "@playwright/test";

import { FORK_PATH } from "./chain-path.ts";

test("the line opens the critical path, and the page marks the same steps as `roadmap status` does", async ({ page }) => {
  await page.goto("/chain-fork/roadmap?state=filled");
  await page.locator("[data-critical-path-link]").click();
  await expect(page.locator(`[data-step-page="${FORK_PATH[0]}"]`)).toBeVisible();
  const marked = await page.locator('[data-chain] [data-critical="yes"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-chain-step")));
  expect(marked).toEqual(FORK_PATH);
  await expect(page.locator("[data-chain-words]")).toContainText("critical path");
  await expect(page.locator("[data-chain-words]")).toContainText("sets the finish");
});

test("a step off the path says where the path is", async ({ page }) => {
  await page.goto("/chain-fork/roadmap/S1?state=filled");
  await expect(page.locator("[data-chain-words]")).toContainText("from C1 to C4");
  await expect(page.locator('[data-chain-step="S1"]')).toHaveAttribute("aria-current", "step");
});

for (const length of [2, 40]) {
  test(`a chain of ${length} steps is drawn in order`, async ({ page }) => {
    await page.goto(`/chain-${length}/roadmap/C1?state=filled`);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("[data-chain-step]")).toHaveCount(length);
    await expect(page.locator('[data-critical="yes"]')).toHaveCount(length);
    await expect(page).toHaveScreenshot(`chain-${length}.png`, { fullPage: true });
  });
}
