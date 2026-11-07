// An error keeps what you saw (U34): when a read fails, the view keeps its last data and the frame says why it is old.
// A lost connection, a stopped service, a slow API and a malformed roadmap file each have a notice in the frame, and a
// bad answer never throws a view away. The server is stopped by refusing its calls from the page.
import { expect, type Page, test } from "@playwright/test";
import { breakRoadmap, startBrowsers } from "./fixture.ts";
import { open, reread } from "./open.ts";

test.use({ timezoneId: "UTC" });

// An open stream of changes would go on after the server's calls are refused, and a view on it never reads again. Without
// it the views read again when the page shows again, which is what these tests ask for.
test.beforeEach(({ page }) => page.route("**/api/live**", (r) => r.abort()));

const VIEWS: { path: string; marker: string }[] = [
  { path: "/", marker: "web-shop" },
  { path: "/web-shop/roadmap/track", marker: "Stock alerts by mail" },
  { path: "/settings", marker: "web-shop" },
  { path: "/usage", marker: "" },
  { path: "/chat", marker: "" },
];

/** Asks again until the frame shows this notice. */
const showing = (page: Page, kind: string) =>
  expect(async () => {
    await reread(page);
    await expect(page.locator(`[data-notice=${kind}]`)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });

/** Every read of the inbox answers after 6.5 s. */
const slowInbox = (page: Page) =>
  page.route("**/api/inbox", async (r) => {
    await new Promise((done) => setTimeout(done, 6500));
    await r.continue().catch(() => undefined);
  });

const stopServer = (page: Page) => page.route("**/api/**", (r) => r.abort("connectionrefused"));

const states = (page: Page) => page.$$eval("[data-view] [data-part-state]", (els) => els.map((e) => e.getAttribute("data-part-state")));

for (const { path, marker } of VIEWS) {
  test(`the server stops under ${path}: the data stays and the frame says Not updated since`, async ({ page }) => {
    await open(page, path, marker);
    const before = await states(page);
    await stopServer(page);
    await showing(page, "stopped");
    await expect(page.locator("[data-notice]")).toContainText(/Not updated since \d\d:\d\d\. Retrying\./);
    expect(await states(page), path).toEqual(before);
    if (marker) await expect(page.locator("[data-view]"), path).toContainText(marker);
  });
}

test.describe("a notice for each trouble", () => {
  test("a lost connection is quiet, keeps the data and goes when the connection is back", async ({ page, context }) => {
    await open(page, "/", "Pay with a saved card");
    await context.setOffline(true);
    await showing(page, "lost");
    await expect(page.locator("[data-notice=lost]")).toContainText("No connection. Not updated since");
    await expect(page.locator("[data-notice=lost]")).toHaveAttribute("role", "status");
    // Home draws live data that settles a moment after the notice
    await expect(page.locator("[data-view]")).toContainText("Pay with a saved card");
    await expect(page).toHaveScreenshot("notice-lost.png", { maxDiffPixelRatio: 0.05 });
    await context.setOffline(false);
    await expect(async () => {
      await reread(page);
      await expect(page.locator("[data-notice]")).toHaveCount(0, { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
  });

  test("a stopped service is red and names the command that starts it", async ({ page }) => {
    await open(page, "/", "Pay with a saved card");
    await stopServer(page);
    await showing(page, "stopped");
    await expect(page.locator("[data-notice=stopped]")).toHaveAttribute("role", "alert");
    await expect(page.locator("[data-notice=stopped] code")).toHaveCount(0);
    await expect(page.locator("[data-view]")).toContainText("Pay with a saved card");
    await expect(page).toHaveScreenshot("notice-stopped.png", { maxDiffPixelRatio: 0.05 });
  });

  test("a slow API (an answer after 5 s) shows a quiet bar over the last data, no laid track", async ({ page }) => {
    await open(page, "/", "Pay with a saved card");
    await slowInbox(page);
    await reread(page);
    await expect(page.locator("[data-notice=slow]")).toBeVisible({ timeout: 9000 });
    await expect(page.locator("[data-notice=slow]")).toHaveAttribute("role", "status");
    await expect(page.locator("[data-view]")).toContainText("Pay with a saved card");
    await expect(page.locator("[data-part-state=loading]")).toHaveCount(0);
    await expect(page).toHaveScreenshot("notice-slow.png", { maxDiffPixelRatio: 0.1 });
    await expect(page.locator("[data-notice=slow]")).toHaveCount(0, { timeout: 10_000 });
  });

  test("a slow API with no data yet shows the laid track under the bar", async ({ page }) => {
    startBrowsers();
    // Home draws from its own read: that one is slow, so it has no data to show yet
    await page.route("**/api/home", async (r) => {
      await new Promise((done) => setTimeout(done, 6500));
      await r.continue().catch(() => undefined);
    });
    await page.goto("/");
    await expect(page.locator("[data-notice=slow]")).toBeVisible({ timeout: 9000 });
    await expect(page.locator("[data-part-state=loading]").first()).toBeVisible();
  });

  test("a malformed roadmap file is red, names the file, the line and the message, and keeps the roadmap", async ({ page }) => {
    await open(page, "/web-shop/roadmap/track", "Stock alerts by mail");
    await expect(page.locator("[data-step]").first()).toBeVisible();
    await breakRoadmap(page, "## P\n\n### X1 Half a step\n- why: w\n- done when: d\n");
    await showing(page, "broken");
    const notice = page.locator("[data-notice=broken]");
    await expect(notice).toHaveAttribute("role", "alert");
    await expect(notice.locator("[data-notice-lines] li").first()).toHaveText(/^docs\/ROADMAP\.md:\d+: .+/);
    await expect(notice.locator("code")).toHaveCount(0);
    await expect(page.locator("[data-step]").first()).toBeVisible();
    await expect(page).toHaveScreenshot("notice-broken.png", { maxDiffPixelRatio: 0.03, mask: [page.locator("[data-badge]")] });
    // Home is not the roadmap: the red goes with the view that asked
    await page.goto("/");
    await expect(page.locator("[data-notice=broken]")).toHaveCount(0);
  });
});

const BAD = [
  "null",
  "[]",
  "{}",
  '"text"',
  "not json",
  "[null]",
  "[{}]",
  '{"projects":[null],"steps":[null],"phases":[null]}',
  '{"projects":[{}],"steps":[{}],"phases":["P"]}',
];

for (const [i, body] of BAD.entries()) {
  test(`each view fed malformed answer ${i + 1} throws nothing uncaught and the frame stays`, async ({ page }) => {
    const thrown: string[] = [];
    page.on("pageerror", (e) => thrown.push(e.message));
    await page.route("**/api/**", (r) => (r.request().url().includes("/api/chat/events") ? r.abort() : r.fulfill({ contentType: "application/json", body })));
    for (const { path } of VIEWS) {
      await page.goto(path);
      await expect(page.locator("[data-frame]")).toBeVisible();
      await page.waitForTimeout(400);
      await expect(page.locator("[data-content]"), `${path} fed ${body}: ${thrown.join(" | ")}`).toBeAttached();
      expect(thrown, `${path} fed ${body}`).toEqual([]);
    }
  });
}
