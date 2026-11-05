// The pictures of the app for the README and the docs: every view on the demo data, at both widths. The list of what
// was taken is docs/shots/list.md, which `bun run check` holds every picture of a view in the docs against.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { SHOT_VIEWS, SHOT_WIDTHS, shotsList } from "../../src/shots.ts";

const SHOTS_DIR = join(import.meta.dirname, "..", "..", "docs", "shots");

test("every view on the demo data, at 390 and 1440 px", async ({ browser }) => {
  mkdirSync(SHOTS_DIR, { recursive: true });
  const taken: string[] = [];
  for (const [width, height] of SHOT_WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: "dark",
      reducedMotion: "reduce",
      ...(width < 768 ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await context.newPage();
    for (const view of SHOT_VIEWS) {
      await page.goto(view.path);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForTimeout(1500);
      const name = `${view.name}-${width}.png`;
      await page.screenshot({ path: join(SHOTS_DIR, name), fullPage: true });
      taken.push(name);
    }
    await context.close();
  }
  writeFileSync(join(SHOTS_DIR, "list.md"), shotsList(taken));
});
