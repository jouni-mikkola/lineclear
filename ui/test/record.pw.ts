// A short recording of each motion into docs/design/motion/: `bun run ui:record`.
import { type Browser, type Page, type TestInfo, test } from "@playwright/test";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { MOTIONS, type Motion } from "../kit/motion.ts";
import sharp from "sharp";
import { at, holdApp, holdBoard, instants, PAIRS } from "./alike.ts";
import { press } from "./bar.ts";
import { LIVE, ROADMAP_LIVE, SETTINGS_LIVE, startFixture, startSettings, writeShopRoadmap } from "./fixture.ts";

const SIZE = { width: 1280, height: 720 };

/** Runs `script` on a fresh page with video on, and keeps the recording as `<file>.webm` in docs/design/motion/. */
async function record(browser: Browser, info: TestInfo, file: string, script: (page: Page) => Promise<void>, size = SIZE) {
  const context = await browser.newContext({ viewport: size, recordVideo: { dir: info.outputPath(), size } });
  const page = await context.newPage();
  await script(page);
  const video = page.video();
  await context.close();
  mkdirSync(OUT, { recursive: true });
  renameSync((await video?.path()) as string, join(OUT, `${file}.webm`));
}

/** Changes the server's files, tells the page to read, and waits for the page to show it. */
async function showChange(page: Page, live: { change: () => void; after: string }) {
  live.change();
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await page.waitForFunction(live.after);
}

const OUT = join(import.meta.dirname, "..", "..", "docs", "design", "motion");
const AT: Record<Motion, string> = {
  "task-start": '[data-line="big"]',
  "task-move": '[data-line="big"]',
  "task-finish": '[data-line="big"]',
  "task-wait": '[data-line="big"]',
  "train-progress": '[data-line="big"]',
  "request-run": '[data-line="big"]',
  "load-shrink": '[data-line="big"]',
  "track-ahead": '[data-line="big"]',
  "engine-swap": '[data-line="big"]',
  "inbox-clear": "[data-inbox]",
  "inbox-arrive": "[data-inbox]",
  "view-change": "[data-view]",
  "browser-open": "[data-browsers]",
  "browser-close": "[data-browsers]",
  "machine-add": "[data-machines]",
  "machine-state": "[data-machines]",
  "model-move": '[data-models="worker"]',
  "chat-arrive": "[data-thread]",
  "chat-open": "[data-chat-open-host]",
  "chat-typing": "[data-design-chat]",
  "part-change": '[data-part="Spend"]',
  "value-change": '[data-part="Spend"]',
};

test.skip(!process.env.RECORD, "only with RECORD=1");

for (const m of Object.keys(MOTIONS) as Motion[]) {
  test(`record ${m}`, ({ browser }, info) =>
    record(browser, info, m, async (page) => {
      await page.goto("/design");
      await page
        .locator(AT[m])
        .first()
        .evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(600);
      for (let i = 0; i < 3; i++) {
        await press(page, `[data-testid="${m}"]`);
        await page.waitForTimeout(900);
      }
    }));
}

// The one loop: a part's track being laid while it loads, on Home's loading state.
test("record track-lay", ({ browser }, info) =>
  record(browser, info, "track-lay", async (page) => {
    await page.goto("/?state=loading");
    await page.waitForTimeout(3200);
  }));

// Home and the Inbox, as the server's files change.
for (const [m, live] of Object.entries(LIVE) as [Motion, NonNullable<(typeof LIVE)[Motion]>][]) {
  test(`record ${m} on ${live.path === "/" ? "Home" : "the Inbox"}`, ({ browser }, info) =>
    record(browser, info, `${live.path === "/" ? "home" : "inbox"}-${m}`, async (page) => {
      startFixture();
      // past the server's one second of keeping what it read
      await page.waitForTimeout(1100);
      await page.goto(live.path);
      await page.waitForTimeout(900);
      await showChange(page, live);
      await page.waitForTimeout(900);
    }));
}

// The Roadmap view, as a step's task starts and as it merges.
for (const [m, live] of Object.entries(ROADMAP_LIVE) as [Motion, NonNullable<(typeof ROADMAP_LIVE)[Motion]>][]) {
  test(`record ${m} on the Roadmap view`, ({ browser }, info) =>
    record(browser, info, `roadmap-${m}`, async (page) => {
      startFixture();
      writeShopRoadmap();
      await page.waitForTimeout(1100);
      await page.goto("/web-shop/roadmap/track");
      await page.waitForTimeout(900);
      await showChange(page, live);
      await page.waitForTimeout(900);
    }));
}

// Settings, as a machine is added and as a model moves with one click.
for (const m of ["machine-add", "model-move"] as const) {
  test(`record ${m} on Settings`, ({ browser }, info) =>
    record(browser, info, `settings-${m}`, async (page) => {
      startSettings();
      await page.goto("/settings");
      await page.waitForSelector('[data-machines] > [data-key="build-box"]');
      await page.locator(m === "model-move" ? '[data-models="worker"]' : "[data-machines]").evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(900);
      const live = SETTINGS_LIVE[m];
      if (live) {
        await showChange(page, live);
      } else {
        await press(page, '[data-down="vendor-a/model-mid"]');
        await page.waitForTimeout(700);
        await press(page, '[data-up="vendor-a/model-mid"]');
      }
      await page.waitForTimeout(900);
    }));
}

// A task's tabs and the search box: a tab is picked with a key and the box opens with `/`.
test("record the task tabs and the search", ({ browser }, info) =>
  record(browser, info, "task-tabs-search", async (page) => {
    await page.goto("/task/WEB-3?state=filled");
    await page.waitForSelector("[data-task-tabs]");
    await page.waitForTimeout(900);
    for (const key of ["2", "3", "4", "1"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(900);
    }
    const box = page.getByLabel("Search tasks, chats and steps");
    await page.keyboard.press("/");
    await box.waitFor();
    await box.fill("cart");
    await page.waitForTimeout(1200);
  }));

// A task's terminal: the tab fades in, a line is typed and sent, a key is sent.
test("record the task terminal", ({ browser }, info) =>
  record(browser, info, "task-terminal", async (page) => {
    await page.goto("/task/WEB-3?state=filled");
    await page.waitForSelector("[data-task-tabs]");
    await page.waitForTimeout(600);
    await page.keyboard.press("2");
    await page.waitForSelector("[data-terminal-screen]");
    await page.waitForTimeout(900);
    await page.getByLabel("Type into the terminal").fill("yes");
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Send" }).click();
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: "Esc" }).click();
    await page.waitForTimeout(900);
  }));

// A task's artifacts: the tab fades in, a card opens full screen and closes.
test("record the task artifacts", ({ browser }, info) =>
  record(browser, info, "task-artifacts", async (page) => {
    await page.goto("/task/WEB-3?tab=artifacts&state=filled");
    await page.waitForSelector("[data-artifact]");
    await page.waitForTimeout(900);
    await page.locator("[data-artifact]").first().click();
    await page.waitForSelector("[data-artifact-full] iframe");
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Close" }).click();
    await page.waitForTimeout(900);
  }));

// The line, at both widths: a request runs, a task starts, creeps, is compacted, is reviewed, waits for you and merges; track is laid, an engine takes over, the Dispatcher writes.
for (const width of [1440, 390]) {
  test(`record the line at ${width} px`, ({ browser }, info) =>
    record(
      browser,
      info,
      `line-${width}`,
      async (page) => {
        await page.goto("/design");
        await page
          .locator('[data-line="big"]')
          .first()
          .evaluate((el) => el.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(800);
        for (const m of [
          "request-run",
          "task-start",
          "train-progress",
          "load-shrink",
          "task-move",
          "task-wait",
          "task-finish",
          "track-ahead",
          "engine-swap",
          "chat-typing",
          "chat-typing",
        ] as Motion[]) {
          await press(page, `[data-testid="${m}"]`);
          await page.waitForTimeout(1100);
        }
      },
      { width, height: width > 600 ? 720 : 844 },
    ));
}

// Each key motion of the app beside the board's, at the same instants (start, every 50 ms, end): one picture per
// motion, a row per instant with the app on the left and the board on the right. They are compared by `alike.pw.ts`.
for (const pair of PAIRS) {
  test(`record ${pair.key} beside the board`, async ({ page: app, context }) => {
    const board = await context.newPage();
    await holdApp(app, pair);
    await holdBoard(board, pair);
    const rows: { input: Buffer; top: number; left: number }[] = [];
    const sizes: { app: Buffer; board: Buffer }[] = [];
    for (const t of instants(pair.app.ms)) {
      await at(app, 0, t);
      await at(board, pair.board.from, Math.min(t, pair.board.ms));
      sizes.push({ app: await app.locator(pair.shot.app).first().screenshot(), board: await board.locator(pair.shot.board).first().screenshot() });
    }
    const metas = await Promise.all(sizes.map(async (s) => ({ a: await sharp(s.app).metadata(), b: await sharp(s.board).metadata() })));
    const widthA = Math.max(...metas.map((m) => m.a.width ?? 0));
    const widthB = Math.max(...metas.map((m) => m.b.width ?? 0));
    let top = 0;
    sizes.forEach((s, i) => {
      const h = Math.max(metas[i]?.a.height ?? 0, metas[i]?.b.height ?? 0);
      rows.push({ input: s.app, top, left: 0 }, { input: s.board, top, left: widthA + 8 });
      top += h + 4;
    });
    mkdirSync(join(OUT, "alike"), { recursive: true });
    await sharp({ create: { width: widthA + widthB + 8, height: top, channels: 3, background: "#0b0b0c" } })
      .composite(rows)
      .png()
      .toFile(join(OUT, "alike", `${pair.key}.png`));
  });
}
