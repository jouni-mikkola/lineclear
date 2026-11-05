// Say each thing once (docs/design.md): no view asks the user to run a command, and no headline repeats the Inbox count.
import { expect, test } from "@playwright/test";

const VIEWS = ["/", "/web-shop/roadmap", "/chat", "/settings", "/design"];
const STATES = ["filled", "long", "empty", "error", "real"];
const COMMAND =
  /\blineclear (move|project|doctor|plan|dispatcher|install|migrate|run|slot|check|roadmap|serve|status|retire|secrets|machine|inbox|uninstall)\b/;

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
      if (view !== "/inbox" && /\b\d+ (things? |items? )?(waits?|wait) for you/i.test(h1)) wrong.push(`${at}: headline "${h1}" repeats the count`);
      if (view === "/inbox" && /\b\d+\b.*\bwaits? for you|waiting for you/i.test(h1)) wrong.push(`${at}: Inbox headline "${h1}" repeats the count`);
    }
  }
  expect(wrong).toEqual([]);
});
