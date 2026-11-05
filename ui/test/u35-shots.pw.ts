// U35's pictures: one frame of the view change, 140 ms into it (the view's own animation, held there), at this width. `U35=before|after bunx playwright test
// ui/test/u35-shots.pw.ts` writes docs/u35/<name>-<width>.png; "before" runs on the commit before U35.
import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test.skip(!process.env.U35, "only with U35=before or U35=after");

test("a view change, 140 ms in", async ({ page, viewport }) => {
  await page.goto("/web-shop/roadmap?state=filled");
  await page.evaluate(() => document.fonts.ready);
  await page.locator('a[aria-label="Lineclear, Home"]:visible').first().click();
  await page.waitForTimeout(800);
  await page.evaluate((ms) => {
    for (const a of document.querySelector("[data-view]")?.getAnimations() ?? []) {
      a.pause();
      a.currentTime = ms;
    }
  }, 140);
  const out = join(import.meta.dirname, "..", "..", "docs", "u35");
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: join(out, `${process.env.U35}-${viewport?.width}.png`) });
});
