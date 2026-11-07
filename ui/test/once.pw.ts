// Say each thing once (docs/design.md): no view asks the user to run a command, and no headline repeats the Inbox count.
import { expect, test } from "@playwright/test";

const VIEWS = ["/", "/web-shop/roadmap", "/chat", "/settings"];
const STATES = ["filled", "long", "empty", "error", "real"];
const COMMAND = /\blineclear (move|project|doctor|plan|dispatcher|install|migrate|run|slot|check|roadmap|serve|status|retire|secrets|inbox|uninstall)\b/;

test("no view shows a lineclear command, or a headline that repeats the Inbox count", async ({ page }) => {
  const wrong: string[] = [];
  for (const view of VIEWS) {
    for (const state of STATES) {
      await page.goto(`${view}?state=${state}`);
      await expect(page.locator("[data-part-state=loading]")).toHaveCount(0, { timeout: 15_000 });
      await page.waitForTimeout(150);
      const { text, h1 } = await page.evaluate(() => ({ text: document.body.textContent ?? "", h1: document.querySelector("h1")?.textContent ?? "" }));
      const at = `${view}?state=${state}`;
      const cmd = text.match(COMMAND);
      if (cmd) wrong.push(`${at}: command "${cmd[0]}"`);
      if (/\b\d+ (things? |items? )?(waits?|wait) for you/i.test(h1)) wrong.push(`${at}: headline "${h1}" repeats the count`);
    }
  }
  expect(wrong).toEqual([]);
});

test("seven doctor findings are one line and a Details row, their commands only inside Details", async ({ page }) => {
  const problems = Array.from({ length: 7 }, (_, i) => `problem ${i + 1}: curl -fsS https://example.com/fix-${i + 1} | sh`);
  await page.route("**/api/home", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), doctor: problems } });
  });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const line = page.locator("[data-doctor]");
    await expect(line).toContainText("7 things on this machine need fixing");
    await expect(line.getByRole("button", { name: "Details" })).toBeVisible();
    expect((await line.boundingBox())?.height).toBeLessThan(60);
    expect(await page.locator("body").textContent()).not.toMatch(/curl|fix-1/);
    const first = await page.locator("[data-line], [data-part]").first().boundingBox();
    expect(first).not.toBeNull();
    expect(first?.y).toBeLessThan(400);
    await line.getByRole("button", { name: "Details" }).click();
    await expect(line).toContainText("curl -fsS");
  }
});
