// Opening a view on the test files, and watching a page for what must never happen on it.
import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { FIXTURE, startBrowsers, writeShopRoadmap } from "./fixture.ts";

/** Every view with an address of its own, the roadmap of the shop project among them. */
export const VIEWS = ["/", "/web-shop/roadmap", "/usage", "/chat", "/settings"];

/** Writes the files, and returns once the server has read them: the page opened next finds them. */
async function prepare(page: Page) {
  startBrowsers();
  writeShopRoadmap();
  // the clock stands at 14:02, so the pictures say the same time on every run
  await page.clock.setFixedTime(new Date("2026-10-31T14:02:00Z"));
  // the server answers with what it last read while it reads again: past this read, the page finds the new files
  await page.waitForTimeout(1100);
  // the server may still answer with the files of the test before, so ask until it has read the new ones
  const answers = async (api: string) => (await page.request.get(api)).text();
  await expect.poll(() => answers("/api/roadmap/web-shop"), { timeout: 20_000 }).toContain("Stock alerts by mail");
  // a rule tick between the clearing and the writing of the files closes the items as the task of them is gone: write them again
  await expect
    .poll(
      async () => {
        const inbox = await answers("/api/inbox");
        if (!inbox.includes("Pay with a saved card")) startBrowsers();
        return inbox;
      },
      { timeout: 20_000 },
    )
    .toContain("Pay with a saved card");
  await page.waitForTimeout(1100);
}

/** Opens a path and waits until no part of it is loading. */
export async function show(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  // the Dispatcher's chat beside Home keeps connecting in this fixture, which has no Dispatcher
  await expect(page.locator("[data-part-state=loading]:not([data-chat-column] *)")).toHaveCount(0, { timeout: 15_000 });
}

export async function open(page: Page, path: string, marker = "") {
  await prepare(page);
  await show(page, path);
  if (marker) await expect(page.locator("[data-view]")).toContainText(marker);
}

export { reread } from "./bar.ts";

/** Runs the CLI on the test files, as a person would on the same data. */
export function cli(...args: string[]): string {
  const env = {
    ...process.env,
    HOME: `${FIXTURE}/home`,
    LINECLEAR_CONFIG: `${FIXTURE}/config`,
    LINECLEAR_STATE: `${FIXTURE}/state`,
    LINECLEAR_HOME: `${FIXTURE}/lineclear`,
    PI_CODING_AGENT_DIR: `${FIXTURE}/pi`,
    LINECLEAR_SERVER_BIN: `${process.cwd()}/ui/test/fake-lineclear`,
  };
  return execFileSync("bin/lineclear", args, { env, encoding: "utf8", stdio: "pipe" });
}

/** What goes wrong on a page from now on: a console error, an uncaught error, an answer of 400 or more, a failed call. */
export function watch(page: Page): string[] {
  const found: string[] = [];
  page.on("console", (m) => m.type() === "error" && found.push(`console error: ${m.text()}`));
  page.on("pageerror", (e) => found.push(`uncaught: ${e.message}`));
  page.on("response", (r) => r.status() >= 400 && found.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  page.on("requestfailed", (r) => !(r.failure()?.errorText ?? "").includes("ERR_ABORTED") && found.push(`failed ${r.url()}: ${r.failure()?.errorText}`));
  return found;
}
