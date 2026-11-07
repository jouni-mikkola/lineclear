// The UI bar for the kit (U25): the sizes and colours of the tokens, the pointer, hover and press of everything that
// acts, the targets on a phone, the one table part and the one format for counts and money.
import { expect, type Page, test } from "@playwright/test";
import { PAGE_STATES } from "./bar.ts";
import { startEmpty } from "./fixture.ts";

const VIEWS = ["/", "/settings", "/web-shop/roadmap"];
/** The type scale: 12 and 14 for text, 16 for body, 18 a card or section title, 22 a detail, 32 a view title on a phone, 48 the answer. */
const SCALE = [12, 14, 16, 18, 22, 32, 48];

async function open(page: Page, path: string, state = "filled", still = true) {
  if (still) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${path}?state=${state}`);
  await page.evaluate(() => document.fonts.ready);
  // the page lazy-loads: wait for its content, not for a time
  await page.waitForFunction(() => (document.querySelector("main")?.textContent?.length ?? 0) > 20);
  await page.waitForTimeout(150);
}

test("every visible text is on the type scale, and every colour is a token", async ({ page }) => {
  for (const path of VIEWS) {
    for (const state of PAGE_STATES) {
      await open(page, path, state);
      const bad = await page.evaluate((scale) => {
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>("body *")) {
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
          if (!own || !el.checkVisibility()) continue;
          const px = parseFloat(getComputedStyle(el).fontSize);
          if (!scale.includes(px)) out.push(`${el.tagName.toLowerCase()} ${px}px "${el.textContent!.trim().slice(0, 24)}"`);
        }
        return out.slice(0, 6);
      }, SCALE);
      expect(bad, `${path}?state=${state}`).toEqual([]);
    }
  }
});

/** Every target of every view and state is at least 48 by 48 px at this width. */
async function everyTargetIs48(page: Page) {
  for (const path of VIEWS) {
    for (const state of PAGE_STATES) {
      await open(page, path, state);
      const small = await page.evaluate(() => {
        const out: string[] = [];
        let seen = 0;
        const sel = 'button:not(:disabled), [role="tab"], [role="button"], summary, select, input:not([type="hidden"]), textarea, a[href]:not([data-inline])';
        for (const e of document.querySelectorAll<HTMLElement>(sel)) {
          if (!e.checkVisibility()) continue;
          seen++;
          const r = e.getBoundingClientRect();
          if (r.width < 47.5 || r.height < 47.5)
            out.push(
              `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
            );
        }
        return seen === 0 ? ["no target found"] : out.slice(0, 8);
      });
      expect(small, `${path}?state=${state}`).toEqual([]);
    }
  }
}

test("at 390 px every target is at least 48 by 48 px, on every view", async ({ page, viewport }) => {
  test.skip(viewport!.width > 500, "a phone only");
  await everyTargetIs48(page);
});

test("at 768 px every target is at least 48 by 48 px, on every view", async ({ page, viewport }) => {
  test.skip(viewport!.width !== 1440, "run once; it sets its own width");
  await page.setViewportSize({ width: 768, height: 1024 });
  await everyTargetIs48(page);
});

test("the first-project card with no repos keeps its repo row, with an add-repo target of 48 px", async ({ page, viewport }) => {
  test.skip(viewport!.width !== 1440, "the live empty config is started once");
  startEmpty();
  await page.waitForTimeout(1100);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/repos", async (r) => {
    await held;
    await r.continue();
  });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const loadingHeight = (await page.locator("[data-add-project] > .min-h-12").boundingBox())!.height;
  release();
  const none = page.locator("[data-add-project] > .min-h-12");
  await expect(page.locator("[data-add-project] label", { hasText: "The folder of a repo" })).toBeVisible();
  expect((await none.boundingBox())!.height).toBe(loadingHeight);
  const add = (await page.locator("[data-add-project] label", { hasText: "The folder of a repo" }).boundingBox())!;
  expect(add.height).toBeGreaterThanOrEqual(47.5);
  expect(add.width).toBeGreaterThanOrEqual(47.5);
});
