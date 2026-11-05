// Plain words on every Roadmap page (the one page, the line, a step, the chain, since you last looked): a step id is
// never bare, it stands before its title, and no lock, slot, quota, check tier or task id shows. The words are those of
// docs/brand.md ("Words").
import { expect, test } from "@playwright/test";

const PAGES = [
  "/web-shop/roadmap?state=filled",
  "/web-shop/roadmap/track?state=filled",
  "/web-shop/roadmap/track?state=many",
  "/budget-app/roadmap/track?state=filled&plan=BUD-12",
  ...["W2", "W3", "W5", "W7"].map((id) => `/web-shop/roadmap/${id}?state=filled`),
  ...["S1", "C2"].map((id) => `/chain-fork/roadmap/${id}?state=filled`),
];

const STEP_ID = /\b[A-Z]{1,3}\d{1,4}\b/g;
const CODES = /\block\b|\bslot\b|\bquota\b|\binner\b|\bnightly\b|\bready to start\b|\b[A-Z]{1,5}-\d+\b/i;

for (const url of PAGES) {
  test(`${url} names every step by its title and uses no code`, async ({ page }) => {
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector("main");
    const text = await page.locator("main").innerText();
    const bare = [...text.matchAll(STEP_ID)].filter((m) => !/^\s+\p{Lu}\p{Ll}/u.test(text.slice((m.index ?? 0) + m[0].length)));
    expect(
      bare.map((m) => text.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + 30)),
      "a step id with no title next to it",
    ).toEqual([]);
    expect(text.match(CODES)?.[0], "a code that is not in docs/brand.md's Words").toBeUndefined();
  });
}
