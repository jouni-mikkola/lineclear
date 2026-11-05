// L76: a page shows one name. No view says the old product's name, in its text, its title or its alt text.
import { expect, test } from "@playwright/test";

const VIEWS = ["/", "/web-shop/roadmap", "/chat", "/settings"];
const OLD = /shepherdr/i;

test("no view shows the old name", async ({ page }) => {
  const seen: string[] = [];
  for (const view of VIEWS) {
    for (const state of ["filled", "long", "empty", "error"]) {
      await page.goto(`${view}?state=${state}`);
      await page.waitForTimeout(500);
      const shown = await page.evaluate(() =>
        [
          document.title,
          document.body.innerText,
          ...[...document.querySelectorAll("[alt],[title],[aria-label],[placeholder]")].flatMap((e) =>
            ["alt", "title", "aria-label", "placeholder"].map((a) => e.getAttribute(a) ?? ""),
          ),
        ].join("\n"),
      );
      if (OLD.test(shown)) seen.push(`${view}?state=${state}: ${shown.split("\n").find((l) => OLD.test(l))}`);
    }
  }
  expect(seen).toEqual([]);
});
