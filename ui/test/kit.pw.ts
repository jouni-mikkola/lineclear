// The UI bar for the kit (U25): the sizes and colours of the tokens, the pointer, hover and press of everything that
// acts, the targets on a phone, the one table part and the one format for counts and money.
import { expect, type Page, test } from "@playwright/test";
import { loops, PAGE_STATES } from "./bar.ts";
import { startEmpty } from "./fixture.ts";

const VIEWS = ["/design", "/", "/settings", "/web-shop/roadmap"];
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

test("everything that acts has a pointer, a 120 ms hover and the press", async ({ page, hasTouch }) => {
  await open(page, "/design", "filled", false);
  const acts = page.locator('a[href]:visible, button:not(:disabled):visible, [role="tab"]:visible');
  const n = await acts.count();
  expect(n).toBeGreaterThan(30);
  const bad: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await acts.nth(i).evaluate((e) => {
      const s = getComputedStyle(e);
      return {
        name: `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 24)}"`,
        cursor: s.cursor,
        hover: s.transitionDuration.split(", ").includes("0.12s") && s.transitionProperty.includes("background-color"),
      };
    });
    if (r.cursor !== "pointer") bad.push(`${r.name}: cursor ${r.cursor}`);
    if (!r.hover) bad.push(`${r.name}: no 120 ms hover`);
  }
  expect(bad).toEqual([]);
  if (hasTouch) return;
  // under the pointer a fill lifts: the colour read 200 ms after the pointer arrives differs from the one at rest
  for (const sel of ['[data-testid="part-change"]', "[data-row]:is(a)", "[data-rail] a:not([aria-current])", "[data-bottom-bar] a:not([aria-current])"]) {
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    const at = (await el.boundingBox())!;
    await page.mouse.move(1, 1);
    await page.waitForTimeout(200);
    const rest = await el.evaluate((e) => getComputedStyle(e).backgroundColor);
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.waitForTimeout(250);
    expect(await el.evaluate((e) => getComputedStyle(e).backgroundColor), sel).not.toBe(rest);
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

test("the lamp has four states, and only two loops exist, each only while it lasts", async ({ page }) => {
  await page.goto("/design");
  await page.waitForSelector("[data-lamp]");
  const lamps = await page.evaluate(() => [...new Set([...document.querySelectorAll("[data-lamp]")].map((e) => e.getAttribute("data-lamp")))].sort());
  expect(lamps).toEqual(expect.arrayContaining(["broken", "check", "clear", "wait"]));
  const ids = new Set(await loops(page));
  expect([...ids].sort()).toEqual(["lamp-wait", "track-lay"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design");
  await page.waitForTimeout(200);
  expect(await loops(page)).toEqual([]);
});

test.describe("the table", () => {
  test("3 rows do not sort; 200 rows sort, keep the header, open details and keep units out of the cells", async ({ page, viewport }) => {
    await open(page, "/design");
    const phone = viewport!.width < 640;
    const small = page.locator('[data-table="Agents, 3 rows"]');
    const big = page.locator('[data-table="Agents, 200 rows"]');
    await big.scrollIntoViewIfNeeded();
    if (phone) {
      expect(await small.locator("[data-table-cards] li").count()).toBe(3);
      expect(await small.getByRole("group", { name: /Sort/ }).count()).toBe(0);
      expect(await big.getByRole("group", { name: /Sort/ }).count()).toBe(1);
      // each card shows two figures
      expect(await big.locator("[data-table-cards] li").first().locator("span.tabular-nums").count()).toBe(2);
      await big.locator("[data-table-cards] li button").first().click();
      await expect(big.locator("[data-table-cards] li").first()).toContainText("tokens so far");
      return;
    }
    expect(await small.locator("thead button").count()).toBe(0);
    expect(await big.locator("thead button").count()).toBe(5);
    // units in the header, not in the cells
    await expect(big.locator("thead")).toContainText("Tokens (tokens)");
    const cells = await big.locator("tbody tr").first().locator("td").allInnerTexts();
    expect(cells.join(" ")).not.toMatch(/\btokens\b|\bmin\b|\$/);
    // figures align right, in tabular figures, with thousands separators
    const num = big.locator("tbody tr").first().locator("td").nth(2);
    expect(await num.evaluate((e) => [getComputedStyle(e).textAlign, getComputedStyle(e).fontVariantNumeric])).toEqual([
      "right",
      expect.stringContaining("tabular-nums"),
    ]);
    expect(await num.innerText()).toMatch(/^\d{1,3}(,\d{3})*$/);
    // sorting by tokens, then again
    await big.locator("thead button", { hasText: "Tokens" }).click();
    const col = async () => (await big.locator("tbody tr td:nth-child(3)").allInnerTexts()).map((t) => Number(t.replace(/,/g, "")));
    const up = await col();
    expect(up).toEqual([...up].sort((a, b) => a - b));
    await big.locator("thead button", { hasText: "Tokens" }).click();
    const down = await col();
    expect(down).toEqual([...down].sort((a, b) => b - a));
    // the header stays while the rows scroll
    const wrap = big.locator("div.overflow-auto");
    await wrap.evaluate((e) => (e.scrollTop = 400));
    const head = await big.locator("thead th").first().boundingBox();
    const box = await wrap.boundingBox();
    expect(Math.abs(head!.y - box!.y)).toBeLessThan(3);
    // a click opens the row's details behind it
    await wrap.evaluate((e) => (e.scrollTop = 0));
    await big.locator("tbody tr").first().click();
    await expect(big.locator("[data-details-of]")).toContainText("tokens so far");
  });
});

test("counts and money have thousands separators on the test page", async ({ page }) => {
  await open(page, "/design");
  const text = await page.evaluate(() => document.body.innerText);
  expect(text.match(/(?<![\d,.#:/-])\d{4,}(?![\d,])/g) ?? []).toEqual([]);
  expect(text).toContain("1,234");
});
