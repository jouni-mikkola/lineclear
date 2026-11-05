// U39: the fresh look. `U39=1 bunx playwright test ui/test/u39.pw.ts --project 1440` takes every view and state at 390, 768,
// 1440 and 2560 px, the board's frame of each, and measures the review's numbers (layout shift, targets under 48 px, type
// sizes off the scale, dead links). It writes into docs/u39/. Slow, so `bun run ui:test` skips it.
import { type Browser, expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isAppPath } from "../web/routes.ts";
import { PAGE_STATES } from "./bar.ts";
import { shiftOf, watchShift } from "./taste.ts";

const OUT = join(import.meta.dirname, "..", "..", "docs", "u39");
const BOARD = `file://${join(import.meta.dirname, "..", "..", "docs", "design", "board.html")}`;
const WIDTHS = [
  [390, 844],
  [768, 1024],
  [1440, 900],
  [2560, 1300],
] as const;

/** Each view, and the board frames it is held against: wide (1440) and phone (390), by state where the board has one. */
const VIEWS: { name: string; path: string; frames: Record<string, [string, string]>; states?: readonly string[] }[] = [
  {
    name: "home",
    path: "/",
    frames: {
      filled: ["home-d", "home-p"],
      many: ["", "home-many"],
      empty: ["first-d", "first-p"],
      loading: ["", "st-load"],
      error: ["", "st-broken"],
      long: ["", "st-long"],
    },
  },
  { name: "roadmap", path: "/web-shop/roadmap", frames: { filled: ["road-d", "road-p"] } },
  { name: "inbox", path: "/inbox", frames: { filled: ["inbox-d", "inbox-p"], many: ["", "inbox-many"] } },
  { name: "chat", path: "/chat", frames: { filled: ["chat-d", "chat-p"], empty: ["", "chat-setup"] } },
  { name: "usage", path: "/usage", frames: { filled: ["usage-d", "usage-p"], empty: ["", "usage-p3"] } },
  { name: "browsers", path: "/browsers", frames: { filled: ["br-d", "br-p"] } },
  { name: "settings", path: "/settings", frames: { filled: ["set-d", "set-p"] } },
  { name: "task", path: "/task/WEB-3", frames: {} },
  { name: "step", path: "/web-shop/roadmap/W4", frames: {} },
];

const SCALE = [...readFileSync(join(import.meta.dirname, "..", "brand", "tokens.css"), "utf8").matchAll(/--lc-text-(?!.*-lh)[\w-]+:\s*(\d+)px/g)].map((m) =>
  Number(m[1]),
);

interface Row {
  view: string;
  state: string;
  width: number;
  shift: number;
  small: string[];
  offScale: string[];
  dead: string[];
}

const INTERACTIVE = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=switch], [role=checkbox]";

type Page = import("@playwright/test").Page;

const smallTargets = (page: Page) =>
  page.evaluate(
    ({ interactive }) => {
      const name = (el: Element) =>
        `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 28)}"`;
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(interactive)) {
        if (!el.checkVisibility()) continue;
        const r = el.getBoundingClientRect();
        const inline = el.tagName === "A" && getComputedStyle(el).display === "inline";
        if (!inline && (r.width < 47.5 || r.height < 47.5)) out.push(`${Math.round(r.width)}x${Math.round(r.height)} ${name(el)}`);
      }
      return out;
    },
    { interactive: INTERACTIVE },
  );

const deadLinks = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      const href = el.getAttribute("href") ?? "";
      if (href === "" || href === "#") out.push(`empty ${href}`);
      else if (/^[a-z]+:/i.test(href) && !/^(https?|mailto):/i.test(href)) out.push(`odd ${href}`);
      else if (/^https?:\/\//i.test(href)) {
        if (!URL.canParse(href)) out.push(`bad ${href}`);
      } else out.push(`path:${new URL(href, location.href).pathname}`);
    }
    return out;
  });

const offScaleType = (page: Page, scale: number[]) =>
  page.evaluate(
    ({ scale }) => {
      const name = (el: Element) =>
        `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 28)}"`;
      const off = new Set<string>();
      for (const el of document.querySelectorAll<HTMLElement>("body *")) {
        if (!el.checkVisibility() || el.closest("svg")) continue;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue;
        const px = Number.parseFloat(getComputedStyle(el).fontSize);
        if (!scale.includes(px)) off.add(`${px}px ${name(el)}`);
      }
      return [...off];
    },
    { scale },
  );

const inspect = async (page: Page, scale: number[]) => ({
  small: await smallTargets(page),
  dead: await deadLinks(page),
  offScale: await offScaleType(page, scale),
});

async function board(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: "dark", reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(BOARD);
  await page.evaluate(() => document.fonts.ready);
  const taken: string[] = [];
  for (const v of VIEWS)
    for (const [, [d, p]] of Object.entries(v.frames))
      for (const id of [d, p]) {
        if (!id || taken.includes(id)) continue;
        const frame = page.locator(`#${id}`);
        await frame.scrollIntoViewIfNeeded();
        await frame.screenshot({ path: join(OUT, `board-${id}.png`) });
        taken.push(id);
      }
  await context.close();
}

test("U39: every view and state at four widths, and the numbers", async ({ browser }) => {
  test.skip(!process.env.U39, "slow: run with U39=1");
  test.setTimeout(900_000);
  mkdirSync(OUT, { recursive: true });
  await board(browser);
  const rows: Row[] = [];
  for (const [width, height] of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: "dark",
      reducedMotion: "reduce",
      timezoneId: "UTC",
      ...(width < 1024 ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await context.newPage();
    await watchShift(page);
    for (const v of VIEWS) {
      for (const state of PAGE_STATES) {
        await page.goto(`${v.path}?state=${state}`);
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator("main")).toBeVisible();
        await page.waitForTimeout(1200);
        const shift = await shiftOf(page);
        const seen = await inspect(page, SCALE);
        await page.screenshot({ path: join(OUT, `${v.name}-${state}-${width}.png`), fullPage: true });
        rows.push({
          view: v.name,
          state,
          width,
          shift,
          small: seen.small,
          offScale: seen.offScale,
          dead: seen.dead.filter((d) => !d.startsWith("path:") || !isAppPath(d.slice(5))),
        });
      }
    }
    await context.close();
  }
  writeFileSync(join(OUT, "measure.json"), JSON.stringify({ scale: SCALE, rows }, null, 1));
});
