// The first run on a clean config, for the cold test (`bun run ui:cold`): Home shows the projects at once, a request
// is typed, and the chain lights step by step until the step is merged. Each step is a picture in docs/cold/, with the
// whole run as one recording, and the cold test reads them in this order.
import { type Page, test } from "@playwright/test";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { reread } from "./bar.ts";
import { startFirstRun, writeItem, writeRequest, writeTasks } from "./fixture.ts";

test.skip(!process.env.COLD, "only with COLD=1");

const OUT = join(import.meta.dirname, "..", "..", "docs", "cold");
const SIZE = { width: 1440, height: 900 };
const PLAN = {
  kind: "plan",
  task: "R1",
  project: "web-shop",
  question: "Approve these steps?",
  choices: ["Approve", "Reject"],
  diff: "+### W5 Pay with a saved card\n",
};
const STEP = { id: "WEB-5", title: "W5 Pay with a saved card" };

/** What the run changes, in order, and the chain's role that lights (or the task's stage) once the page read it. */
const STEPS: { name: string; change: () => void; lit: string }[] = [
  { name: "planner", change: () => writeRequest("R1", "Pay with a saved card"), lit: '[data-role="planner"][data-live]' },
  {
    name: "you",
    change: () => writeItem(1, PLAN),
    lit: '[data-role="you"][data-live]',
  },
  {
    name: "rules",
    change: () => {
      writeItem(1, { ...PLAN, answer: "Approve" });
      writeTasks([STEP]);
    },
    lit: '[data-role="rules"][data-live]',
  },
  { name: "worker", change: () => writeTasks([{ ...STEP, told: "work" }]), lit: '[data-role="worker"][data-live]' },
  { name: "reviewer", change: () => writeTasks([{ ...STEP, told: "work", sub: "in review, round 1" }]), lit: '[data-role="reviewer"][data-live]' },
  { name: "merged", change: () => writeTasks([{ ...STEP, merged: true }]), lit: '[data-stage="done"]' },
];

async function shot(page: Page, n: number) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `first-run-${n}.png`) });
}

test("first run", async ({ browser }, info) => {
  startFirstRun();
  // past the server's one second of keeping what it read
  await new Promise((r) => setTimeout(r, 1100));
  const context = await browser.newContext({ viewport: SIZE, colorScheme: "dark", recordVideo: { dir: info.outputPath(), size: SIZE } });
  const page = await context.newPage();
  // the Dispatcher takes a moment to read the request: the chat's own answer is not part of this picture
  await page.route("**/api/chat", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('[data-project="web-shop"], [data-track="web-shop"]');
  await page.waitForTimeout(1200);
  await shot(page, 1);
  await page.getByLabel("Ask the Dispatcher").fill("Let customers pay with a saved card");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForSelector('[data-role="dispatcher"][data-live]');
  await page.waitForTimeout(700);
  await shot(page, 2);
  let n = 3;
  for (const step of STEPS) {
    step.change();
    await reread(page);
    await page.waitForSelector(step.lit, { state: "attached" });
    await page.waitForTimeout(900);
    await shot(page, n++);
  }
  const video = page.video();
  await context.close();
  renameSync((await video?.path()) as string, join(OUT, "first-run.webm"));
});
