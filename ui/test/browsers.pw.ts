// The agent browsers' server side. `/browsers` is a view of its own: the server's rule
// about input is checked from Home, with the sessions ui/test/fake-playwright-cli lists.
import { expect, test } from "@playwright/test";
import { browserInputs, startBrowsers } from "./fixture.ts";

test("the server takes no input from a browser that is not taken over", async ({ page }) => {
  startBrowsers();
  await page.goto("/");
  // past the server's one second of keeping what it read
  await page.waitForTimeout(1100);
  const status = await page.evaluate(async () => {
    const res = await fetch("/api/browsers/scratch/input", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ do: "type", text: "x" }),
    });
    return res.status;
  });
  expect(status).toBe(409);
  expect(browserInputs()).toBe("");
});
