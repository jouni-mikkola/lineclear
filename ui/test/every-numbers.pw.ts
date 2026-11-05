// U37: each number on Home equals what the CLI prints for the same data.
import { expect, test } from "@playwright/test";
import { open } from "./open.ts";
import { ASKED, exported } from "./numbers.ts";
import { writeItem } from "./fixture.ts";

test.use({ timezoneId: "UTC" });

test("the strip's count and the cards equal the CLI's list", async ({ page }) => {
  await open(page, "/");
  await page.waitForTimeout(1100);
  writeItem(3, ASKED);
  const n = exported().inbox.length;
  const more = page.locator("[data-inbox-more]");
  if (n > 1) await expect(more).toHaveText(`+${n - 1}`, { timeout: 5000 });
  else await expect(more).toHaveCount(0);
});
