// The step check on screen: a plan's Inbox card has one line per step with its go and the checking model and its
// words one tap away; a step's page has the check in its history. A no-go never shows in the Inbox.
import { expect, test } from "@playwright/test";

test("a plan card shows each step's go and model, its words one tap away, and no no-go", async ({ page }) => {
  await page.goto("/inbox/i4?state=filled");
  const card = page.locator("[data-inbox-strip]", { hasText: "gift cards" });
  const lines = card.locator("[data-cold-go]");
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toContainText("W13");
  await expect(lines.first()).toContainText("go");
  await expect(lines.first()).toContainText("vendor-b/model-review");
  await expect(card.getByText("spends it at checkout")).toBeHidden();
  await lines.first().locator("summary").click();
  await expect(card.getByText("spends it at checkout")).toBeVisible();
  await expect(page.locator('[data-cold-go="no-go"]')).toHaveCount(0);
  await expect(page).toHaveScreenshot("step-check-card.png", { fullPage: true });
});

test("a step's page has the check in its history, a no-go there with what is missing", async ({ page }) => {
  await page.goto("/web-shop/roadmap/W7?state=filled");
  const history = page.locator('[data-step-part="history"]');
  const lines = history.locator("[data-cold-go]");
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toHaveAttribute("data-cold-go", "no-go");
  await lines.first().locator("summary").click();
  await expect(history).toContainText("who gets the mail is not said");
  await expect(page).toHaveScreenshot("step-check-page.png", { fullPage: true });
});

for (const state of ["long", "many"]) {
  test(`the Inbox in the ${state} state keeps cards with a check inside the width`, async ({ page }) => {
    await page.goto(`/inbox${state === "long" ? "/ilp" : ""}?state=${state}`);
    if (state === "long") await expect(page.locator("[data-inbox-checks]")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
