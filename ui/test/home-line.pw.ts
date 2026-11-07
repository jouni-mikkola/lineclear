// U20: the Home line stays inside the window and its box, at every width and with many tasks.
import { expect, test } from "@playwright/test";

test("the line's right end and its last station sit inside the window", async ({ page, viewport }) => {
  const width = viewport?.width ?? 0;
  for (const state of ["filled", "many"]) {
    await page.goto(`/?state=${state}`);
    await page.waitForSelector("[data-line] [data-track]");
    await page.waitForTimeout(300);
    // the line's box clips what runs past its right edge, so that edge is the limit too
    const clip = await page.evaluate(() => document.querySelector("[data-line]")?.getBoundingClientRect().right ?? 0);
    const limit = Math.min(width, clip);
    // the last station of each track is its "merged" label, the line's rightmost drawn part
    const ends = await page.evaluate(() => {
      const root = document.querySelector("[data-line]");
      let right = 0;
      for (const el of root?.querySelectorAll("*") ?? []) {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && getComputedStyle(el).visibility !== "hidden") right = Math.max(right, b.right);
      }
      const merged = [...(root?.querySelectorAll("[data-track] span") ?? [])].filter((e) => e.textContent === "merged");
      return { right, merged: merged.map((e) => e.getBoundingClientRect().right), scroll: document.documentElement.scrollWidth };
    });
    expect(ends.merged.length, state).toBeGreaterThan(0);
    for (const r of ends.merged) expect(r, state).toBeLessThanOrEqual(limit);
    expect(ends.right, state).toBeLessThanOrEqual(limit);
    expect(ends.scroll, state).toBeLessThanOrEqual(width);
  }
});

test("the line stays in its box and does not run down the page, even with many tasks", async ({ page, viewport }) => {
  const height = viewport?.height ?? 0;
  for (const state of ["filled", "many"]) {
    await page.goto(`/?state=${state}`);
    await page.waitForSelector("[data-line] [data-track]");
    await page.waitForTimeout(300);
    const box = await page.locator("section[data-line]").boundingBox();
    expect(box?.height ?? 0, state).toBeLessThan(height * 0.75);
  }
});

test("Home opens with the four zones, the Dispatcher's box above, and a labelled token per open task", async ({ page }) => {
  await page.goto("/?state=filled");
  await page.waitForSelector("[data-line] [data-track]");
  const zones = await page
    .locator("[data-line] [data-zone]")
    .evaluateAll((els) => els.map((e) => ({ name: e.getAttribute("data-zone"), x: e.getBoundingClientRect().left })));
  expect(zones.map((z) => z.name)).toEqual(["In line", "At work", "In review", "main"]);
  const xs = zones.map((z) => z.x);
  expect(xs).toEqual([...xs].sort((a, b) => a - b));
  const box = await page.locator("[data-line] [data-signal-box]").boundingBox();
  const zone = await page.locator('[data-line] [data-zone="At work"]').boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((zone?.y ?? 0) + (zone?.height ?? 0));
  const tokens = page.locator('[data-line] [aria-label="Tasks on the line"] [data-task][data-stage]:not([aria-hidden])');
  expect(await tokens.count()).toBeGreaterThan(0);
  const stages = await tokens.evaluateAll((els) => els.map((e) => e.getAttribute("data-stage")));
  for (const st of stages) expect(["queued", "work", "review", "ready", "done"]).toContain(st);
  const first = tokens.first();
  const id = await first.getAttribute("data-task");
  expect((await first.textContent())?.trim().length).toBeGreaterThan(0);
  // hover shows the title, the model and the time at the stage
  await first.locator("a, button, [tabindex]").first().hover();
  const card = page.locator(`[data-card="${id}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(" · ");
  await expect(card.locator("p").first()).not.toBeEmpty();
});
