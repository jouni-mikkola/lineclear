// The UI bar on Home (`/`), served by `lineclear run`. The pictures use the sample states
// (`?state=`); the rest reads the files the server reads, and changes them to make each motion.
import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MOTIONS, type Motion } from "../kit/motion.ts";
import { clickAfterReread, liveMotionTests, PAGE_STATES, reread, running, shotEveryState, traceMotion } from "./bar.ts";
import { BASE, FIXTURE, LIVE, startFixture, writeItem, writeTasks } from "./fixture.ts";

/** A second click in the middle of each live motion, and what it shows. */
const MID: Record<string, { second: string; shown: string }> = {
  "/": {
    second: '[data-row-id="API-1"]:visible',
    shown: `[...document.querySelectorAll('[data-row-id="API-1"] [aria-expanded]')].some((b) => b.getAttribute("aria-expanded") === "true")`,
  },
};

async function fresh(page: Page, path: string) {
  startFixture();
  // past the server's one second of keeping what it read, before and after the page reads it
  await page.waitForTimeout(1100);
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("[data-home] [data-row-id]:visible");
  await page.waitForTimeout(1100);
}

test("Home in every state, at this width", async ({ page }) => {
  await shotEveryState(page, "/", "home");
});

test("the logo goes Home and opens nothing, off Home and on it", async ({ page }) => {
  await page.goto("/settings?state=filled");
  await page.evaluate(() => document.fonts.ready);
  const logo = page.locator('a[aria-label="Lineclear, Home"]:visible');
  await expect(page.getByRole("button", { name: "How it works" })).toHaveCount(0);
  await logo.click();
  await expect(page).toHaveURL(/\/(\?|$)/);
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await logo.click();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
});

test("the navigation is fully in view, in one style, on every view and in every state, at this width", async ({ page, viewport }) => {
  const wide = viewport!.width >= 1024;
  const names = wide ? ["Home", "Settings"] : ["Home"];
  // Home has no bottom bar: it is the one view, and the bar is for the views beside it
  for (const path of wide ? ["/", "/web-shop/roadmap", "/settings"] : ["/web-shop/roadmap", "/settings"]) {
    for (const state of PAGE_STATES) {
      await page.goto(`${path}?state=${state}`);
      await page.waitForSelector('nav[aria-label="Views"] a:visible');
      await page.evaluate(() => document.fonts.ready);
      const nav = await page.evaluate(() => {
        const list = [...document.querySelectorAll<HTMLElement>('nav[aria-label="Views"]')].find(
          (n) => n.offsetParent !== null || getComputedStyle(n).position === "fixed",
        ) as HTMLElement;
        const box = list.getBoundingClientRect();
        return {
          scrolls: list.scrollWidth > list.clientWidth,
          links: [...list.querySelectorAll<HTMLElement>("a[href]:not([aria-label='Lineclear, Home'])")].map((a) => {
            const r = a.getBoundingClientRect();
            return {
              name: a.innerText.split("\n")[0] ?? "",
              inView: r.left >= box.left && r.right <= box.right && r.bottom <= innerHeight,
              current: a.getAttribute("aria-current"),
            };
          }),
        };
      });
      const where = `${path}?state=${state}`;
      expect(nav.scrolls, where).toBe(false);
      expect(
        nav.links.slice(0, names.length).map((t) => t.name),
        where,
      ).toEqual(names);
      // the first links are the views, in view; project rows may run past the screen in the rail, which scrolls
      for (const t of nav.links.slice(0, names.length)) expect(t.inView, where).toBe(true);
      // under 1024 px Settings is a gear at the top, which is the link you are on there
      const here = nav.links.filter((t) => t.current).length;
      if (path.endsWith("/roadmap")) expect(here, where).toBeLessThanOrEqual(1);
      else expect(here, where).toBe(path === "/settings" && !wide ? 0 : 1);
    }
  }
});

test("Home's line in its own states: nothing at work, all clear, 30 tasks, offline", async ({ page }) => {
  for (const state of ["idle", "clear", "thirty", "offline"]) {
    await page.goto(`/?state=${state}`);
    await page.waitForSelector('[data-line="big"]');
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`home-${state}.png`, { fullPage: true });
  }
});

test("the line under a project wraps to at most three lines and is never cut; a blocker with long text keeps its link", async ({ page, viewport }) => {
  for (const state of ["filled", "long", "many"]) {
    await page.goto(`/design?state=${state}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector("[data-where]");
    const lines = await page.$$eval("[data-where]:has([data-where-finish])", (els) =>
      els.map((el) => {
        const box = el as HTMLElement;
        const centres = [...box.querySelectorAll("[data-where-phase], [data-where-phase-short], [data-where-next], [data-where-blocker], [data-where-finish]")]
          .flatMap((e) => [...e.getClientRects()].map((r) => r.top + r.height / 2))
          .sort((a, b) => a - b);
        // two boxes on one line have centres within a few px; the next line is at least a line apart
        const rows = centres.filter((c, i) => i === 0 || c - (centres[i - 1] as number) > 10).length;
        return { text: box.innerText, rows, cut: box.scrollWidth > box.clientWidth };
      }),
    );
    console.log("U9", viewport?.width, state, JSON.stringify(lines.map((l) => l.rows)));
    for (const l of lines) {
      expect(l.cut, l.text).toBe(false);
      expect(l.rows, l.text).toBeLessThanOrEqual(3);
    }
    if (state === "long" && viewport?.width === 390) expect(Math.max(...lines.map((l) => l.rows))).toBe(3);
  }
  await page.goto("/design?state=long");
  await page.evaluate(() => document.fonts.ready);
  const where = page.locator("[data-where]:has([data-where-blocker])").first();
  await expect(where.locator("[data-where-blocker]")).toHaveAttribute("href", "/inbox");
  await expect(where).toHaveScreenshot("where-blocker-long.png");
});

test("the first load: the logo is in the HTML's own paint and nothing shifts as data comes", async ({ page, viewport }) => {
  startFixture();
  await page.waitForTimeout(1100);
  await page.route("**/*.js", (r) => r.abort());
  await page.goto("/");
  // with no script at all, the page already paints the logo; from 1024 px the rail holds it and the script draws the rail
  if (viewport!.width < 1024) {
    await expect(page.locator('header [aria-label="Lineclear"]')).toBeVisible();
    expect((await page.locator('header [aria-label="Lineclear"]').boundingBox())?.height ?? 0).toBeGreaterThan(20);
  }
  await page.unroute("**/*.js");
  await page.addInitScript(() => {
    const w = window as any;
    w.shifts = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e: any) => !e.hadRecentInput && (w.shifts += e.value))).observe({
      type: "layout-shift",
      buffered: true,
    });
  });
  await page.goto("/");
  await page.waitForSelector("[data-home] [data-row-id]:visible");
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as any).shifts as number)).toBeLessThan(0.1);
});

test.describe("live", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "the live views are checked once, at 1440 px");

  test("a waiting token's link shows its ask first in the strip once the list is read", async ({ page }) => {
    startFixture();
    for (let n = 1; n <= 12; n++) writeItem(n, { question: `Question ${n}?`, choices: ["Yes", "No"], task: `WEB-${n}` });
    await page.waitForTimeout(1100);
    await page.goto("/inbox/7");
    await expect(page.locator("[data-inbox-strip]")).toContainText("Question 7?");
    expect(await page.evaluate(() => document.querySelector("[data-inbox-strip]")!.getBoundingClientRect().top < innerHeight)).toBe(true);
  });

  test("Home answers from the server's files: a row per working task and the Inbox strip", async ({ page }) => {
    await fresh(page, "/");
    await expect(page.locator('[data-row-id="WEB-1"]:visible')).toContainText("Pay with a saved card");
    await expect(page.locator("[data-project-state=broken]")).toHaveCount(0);
    await expect(page.locator("[data-inbox-strip]")).toBeVisible();
  });

  test("a waiting task's chat link opens its chat in this UI, never another port", async ({ page }) => {
    await fresh(page, "/");
    writeTasks(BASE, { need: ["WEB-3"] });
    await page.waitForTimeout(1200);
    await page.goto("/inbox/WEB-3");
    const link = page.locator('[data-chat-link="WEB-3"]');
    await expect(link).toHaveAttribute("href", "/task/WEB-3");
    await link.click();
    await expect(page).toHaveURL(/\/task\/WEB-3$/);
    await expect(page.locator("[data-task-head]")).toBeVisible();
  });

  test("the strip: answers as buttons, details with one click, no popup, a reason in place, an answer that fails brings the ask back", async ({ page }) => {
    await fresh(page, "/");
    writeItem(2, {
      kind: "plan",
      task: "WEB-9",
      question: "Approve the new roadmap for web-shop?",
      choices: ["Approve", "Reject"],
      diff: "+ ### W5 Gift cards",
    });
    await page.goto("/inbox/2");
    const strip = page.locator("[data-inbox-strip]").first();
    await expect(strip.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(page.locator('[role="dialog"], [popover], dialog')).toHaveCount(0);
    // a plan's rejection needs a reason: the strip asks for it in place, and sends it with the answer
    await strip.getByRole("button", { name: "Reject" }).click();
    await strip.getByRole("textbox").fill("Gift cards wait for the payment step");
    await strip.locator('button[type="submit"]').click();
    const plan = () => JSON.parse(readFileSync(join(FIXTURE, "config", "inbox", "2.json"), "utf8"));
    await expect.poll(() => plan().answer, { timeout: 10_000 }).toBe("Reject");
    expect(plan().note).toBe("Gift cards wait for the payment step");
    // an answer that does not reach the server brings the ask back with the reason
    writeItem(3, { question: "Release 2.4 to production?", choices: ["Release", "Not yet"] });
    await page.route("**/api/inbox/3", (r) => r.abort());
    await page.goto("/inbox/3");
    await page.locator("[data-inbox-strip]").first().getByRole("button", { name: "Release" }).click();
    await expect(page.locator("[data-inbox-strip]").first()).toContainText("The server did not answer. Try again.", { timeout: 10_000 });
  });

  test("the line with 30 tasks: 60 fps as a token glides, at a quarter of this CPU", async ({ page }) => {
    const thirty = Array.from({ length: 30 }, (_, i) => ({
      id: `${i % 2 ? "API" : "WEB"}-${i + 1}`,
      title: `T${i + 1} Task number ${i + 1}`,
      ...(i % 3 ? { told: "work" } : {}),
      ...(i % 5 === 1 ? { sub: "In review" } : {}),
    }));
    await fresh(page, "/");
    writeTasks(thirty);
    await reread(page);
    await page.waitForFunction(() => document.querySelectorAll("[data-line] [data-task]").length >= 10);
    await page.waitForTimeout(1100);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    // T1 starts: its token glides from Rules to Worker, on the big line and its project's small one
    writeTasks(thirty.map((t, i) => (i === 0 ? { ...t, told: "work" } : t)));
    const f = await traceMotion(page, () => reread(page), MOTIONS["task-start"].ms);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    test.info().annotations.push({ type: "frames", description: JSON.stringify(f) });
    console.log(`the line, 30 tasks, 4x CPU slowdown: ${JSON.stringify(f)}`);
    expect(await page.evaluate(() => (document.querySelector('[data-task="WEB-1"]') as HTMLElement | null)?.dataset.stage)).toBe("work");
    expect(f.fps).toBeGreaterThanOrEqual(55);
    expect(f.worstMs).toBeLessThan(50);
  });

  test("nothing moves at rest, while the views read the server", async ({ page }) => {
    await fresh(page, "/");
    await page.waitForTimeout(3500);
    expect(await running(page)).toEqual([]);
  });

  liveMotionTests({
    moves: Object.entries(LIVE) as [Motion, NonNullable<(typeof LIVE)[Motion]>][],
    fresh: (page, live) => fresh(page, live.path),
    prepare: (live) => live.change(),
    act: reread,
    click: (page, m, live) => {
      const { second, shown } = MID[live.path] ?? { second: "", shown: "false" };
      return clickAfterReread(page, m, second, shown);
    },
  });
});
