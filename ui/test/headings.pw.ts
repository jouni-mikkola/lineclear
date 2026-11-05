// U16: the primary answer button is calm, and every view's headings are in order (one h1, sections h2, cards h3),
// with a project's heading reading only its name.
import { expect, test } from "@playwright/test";

const VIEWS = ["/", "/web-shop/roadmap", "/chat", "/settings"];
/** States one view has of its own: the chat with a plan card in its thread. */
const OWN: Record<string, string[]> = { "/chat": ["request"] };

test("each view has one h1 and its headings never skip a level", async ({ page }) => {
  const wrong: string[] = [];
  for (const view of VIEWS) {
    for (const state of ["filled", "long", "empty", "loading", "error", ...(OWN[view] ?? [])]) {
      await page.goto(`${view}?state=${state}`);
      await page.waitForTimeout(800);
      const levels = await page.$$eval("h1, h2, h3, h4, h5, h6", (els) => els.map((el) => Number(el.tagName[1])));
      const at = `${view}?state=${state}`;
      if (levels.filter((l) => l === 1).length !== 1) wrong.push(`${at}: ${levels.filter((l) => l === 1).length} h1`);
      else if (levels[0] !== 1) wrong.push(`${at}: h${levels[0]} before the h1`);
      for (const [i, l] of levels.entries()) if (i && l > levels[i - 1]! + 1) wrong.push(`${at}: h${levels[i - 1]} then h${l}`);
    }
  }
  expect(wrong).toEqual([]);
});

test("the strip's primary answer button is filled with the action token, neither the accent nor a red", async ({ page }) => {
  await page.goto("/?state=filled");
  const first = page.locator("[data-inbox-signal] button").first();
  await first.waitFor();
  const fills = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const probe = document.createElement("span");
    document.body.append(probe);
    const rgb = (v: string) => {
      probe.style.color = css.getPropertyValue(v);
      return getComputedStyle(probe).color;
    };
    const out = { action: rgb("--lc-action"), accent: rgb("--lc-accent"), stop: rgb("--lc-stop") };
    probe.remove();
    return out;
  });
  const fill = await first.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(fill).toBe(fills.action);
  expect(fill).not.toBe(fills.accent);
  expect(fill).not.toBe(fills.stop);
  // and it reads as no red: its red does not stand far above its green and blue
  const [r, g, b] = fill.match(/\d+/g)!.map(Number);
  expect(r! - Math.max(g!, b!)).toBeLessThan(40);
});
