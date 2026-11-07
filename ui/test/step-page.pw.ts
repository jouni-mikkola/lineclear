// The page of one step (`/<project>/roadmap/<step>`), on the sample states: a done step, a step at work, one that waits
// on a lock and one that waits for you each show their parts in order, at this width.
import { expect, test } from "@playwright/test";

const PARTS = ["gives", "checklist", "state", "history"];

const CASES: [string, string, string][] = [
  ["done", "W2", "merge commit"],
  ["at work", "W5", "named in the facts of its task"],
  ["waits on a part another step uses", "W7", "uses the same part as"],
  ["waits for you", "W3", "Pick A or B"],
];

for (const [name, id, said] of CASES) {
  test(`a step that is ${name} shows its parts in order, at this width`, async ({ page }) => {
    await page.goto(`/web-shop/roadmap/${id}?state=filled`);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(`[data-step-page="${id}"]`)).toBeVisible();
    await expect(page.locator("[data-step-part]")).toHaveCount(PARTS.length);
    expect(await page.locator("[data-step-part]").evaluateAll((els) => els.map((e) => e.getAttribute("data-step-part")))).toEqual(PARTS);
    await expect(page.locator("main")).toContainText(said);
    await expect(page).toHaveScreenshot(`step-${id}.png`, { fullPage: true });
  });
}

test("an item with no evidence says so, and a merged step has none open", async ({ page }) => {
  await page.goto("/web-shop/roadmap/W5?state=filled");
  await expect(page.locator('[data-item="open"]').first()).toContainText("no evidence yet");
  await page.goto("/web-shop/roadmap/W2?state=filled");
  await expect(page.locator('[data-item="open"]')).toHaveCount(0);
});
