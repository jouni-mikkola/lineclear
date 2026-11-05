// U37: the data changes under an open page, and each view shows the change within 3 s with no reload.
import { expect, test } from "@playwright/test";
import { writeItem } from "./fixture.ts";
import { open } from "./open.ts";
import { ASKED, exported, mark, unloaded } from "./numbers.ts";

test.use({ timezoneId: "UTC" });

test.describe("the data changes under an open page", () => {
  test("an item arriving in the Inbox shows within 3 s, with no reload", async ({ page }) => {
    await open(page, "/");
    await mark(page);
    // past the server's second of keeping what it read, so the new file is not taken for the old list
    await page.waitForTimeout(1100);
    writeItem(3, ASKED);
    await expect(page.locator("[data-inbox-more]")).toHaveText(`+${exported().inbox.length - 1}`, { timeout: 3000 });
    expect(await unloaded(page)).toBe(true);
  });
});
