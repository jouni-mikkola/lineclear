// The UI bar on the design system's test page, served by `lineclear run`.
import { expect, test } from "@playwright/test";
import { MOTIONS, type Motion } from "../kit/motion.ts";
import { clickMidMotion, liveMotionTests, NAMES, press, running, shotEveryState } from "./bar.ts";

const button = (m: Motion) => `[data-testid="${m}"]`;

/** Where each motion shows, and what one press of its button changes, on a fresh page. */
const SHOWS: Record<Motion, { at: string; after: string }> = {
  "task-start": { at: '[data-line="big"]', after: `document.querySelector('[data-task="w6"]')?.dataset.state === "work"` },
  "task-move": { at: '[data-line="big"]', after: `document.querySelector('[data-task="w2"]')?.dataset.stage === "review"` },
  "task-finish": { at: '[data-line="big"]', after: `document.querySelector('[data-project="web-shop"] [data-count]')?.dataset.count === "15"` },
  "task-wait": { at: '[data-line="big"]', after: `document.querySelector('[data-task="w2"]')?.dataset.state === "need"` },
  "train-progress": { at: '[data-line="big"]', after: `document.querySelector('[data-task="w2"]')?.dataset.progress === "0.70"` },
  "request-run": { at: '[data-line="big"]', after: `!!document.querySelector('[data-task="req0"]')` },
  "load-shrink": { at: '[data-line="big"]', after: `document.querySelector('[data-task="w2"]')?.dataset.load === "0.156"` },
  "track-ahead": { at: '[data-line="big"]', after: `document.querySelector('[data-track="mail-queue"] [data-ahead-label]')?.dataset.aheadLabel === "7"` },
  "engine-swap": {
    at: '[data-line="big"]',
    after: `document.querySelector('[data-line="big"] [data-engine="home-subscription"]')?.dataset.lit === "true" && !document.querySelector('[data-line="big"] [data-engine="work-subscription"][data-lit]')`,
  },
  "inbox-clear": { at: "[data-inbox]", after: `!document.querySelector('[data-key="i1"] [data-inbox-signal="caution"]')` },
  "inbox-arrive": { at: "[data-inbox]", after: `!!document.querySelector('[data-key="new0"]')` },
  "view-change": { at: "[data-view]", after: `!!document.querySelector('[data-view="inbox"]')` },
  "browser-open": { at: "[data-browsers]", after: `!!document.querySelector('[data-browsers] > [data-key="new0"]')` },
  "browser-close": { at: "[data-browsers]", after: `!document.querySelector('[data-browsers] > [data-key="WEB-2"]')` },
  "machine-add": { at: "[data-machines]", after: `!!document.querySelector('[data-machines] > [data-key="new-box-1"]')` },
  "machine-state": { at: "[data-machines]", after: `document.querySelector('[data-machine="build-box"]')?.dataset.state === "failed"` },
  "model-move": { at: '[data-models="worker"]', after: `document.querySelector('[data-models="worker"] > li')?.dataset.model === "vendor-b/model-code"` },
  "chat-arrive": { at: "[data-thread]", after: `!!document.querySelector('[data-thread] > [data-key="new-chat-0"]')` },
  "chat-open": { at: "[data-chat-open-host]", after: `!!document.querySelector('[data-chat-open-demo]')` },
  "chat-typing": { at: "[data-design-chat]", after: `!!document.querySelector('[data-typing]')` },
  "part-change": { at: '[data-part="Spend"]', after: `!!document.querySelector('[data-part="Spend"][data-part-state="empty"]')` },
  "value-change": { at: '[data-part="Spend"]', after: `document.querySelector('[data-part="Spend"] [data-count]')?.dataset.count === "11.85"` },
};

/** A second press in the middle of each motion, and what it shows. */
const MID: Record<Motion, { second: string; shown: string }> = {
  "task-start": { second: button("task-finish"), shown: `document.querySelector('[data-project="web-shop"] [data-count]')?.dataset.count === "15"` },
  "task-move": { second: button("task-move"), shown: `document.querySelector('[data-task="b2"]')?.dataset.stage === "review"` },
  "task-finish": { second: button("task-finish"), shown: `document.querySelector('[data-project="web-shop"] [data-count]')?.dataset.count === "16"` },
  "task-wait": { second: button("task-wait"), shown: `document.querySelector('[data-task="w3"]')?.dataset.state === "need"` },
  "train-progress": { second: button("train-progress"), shown: `document.querySelector('[data-task="w2"]')?.dataset.progress === "0.95"` },
  "request-run": { second: button("request-run"), shown: `!!document.querySelector('[data-task="req1"]')` },
  "load-shrink": { second: button("load-shrink"), shown: `document.querySelector('[data-task="w2"]')?.dataset.load === "0.850"` },
  "track-ahead": { second: button("track-ahead"), shown: `document.querySelector('[data-track="mail-queue"] [data-ahead-label]')?.dataset.aheadLabel === "8"` },
  "engine-swap": {
    second: button("engine-swap"),
    shown: `document.querySelector('[data-line="big"] [data-engine="work-subscription"]')?.dataset.lit === "true" && !document.querySelector('[data-line="big"] [data-engine="home-subscription"][data-lit]')`,
  },
  "inbox-clear": { second: '[data-key="i2"] button', shown: `!document.querySelector('[data-key="i2"] [data-inbox-signal="caution"]')` },
  "inbox-arrive": { second: '[data-key="new0"] button', shown: `!document.querySelector('[data-key="new0"] [data-inbox-signal="caution"]')` },
  "view-change": { second: button("view-change"), shown: `!!document.querySelector('[data-view="browsers"]')` },
  "browser-open": { second: button("browser-close"), shown: `!document.querySelector('[data-browsers] > [data-key="new0"]')` },
  "browser-close": { second: button("browser-open"), shown: `!!document.querySelector('[data-browsers] > [data-key="new0"]')` },
  "machine-add": { second: button("machine-add"), shown: `!!document.querySelector('[data-machines] > [data-key="new-box-2"]')` },
  "machine-state": { second: button("machine-state"), shown: `document.querySelector('[data-machine="build-box"]')?.dataset.state === "unreachable"` },
  "model-move": { second: button("model-move"), shown: `document.querySelector('[data-models="worker"] > li')?.dataset.model === "vendor-c/model-pro"` },
  "chat-arrive": { second: button("chat-arrive"), shown: `!!document.querySelector('[data-thread] > [data-key="new-chat-1"]')` },
  "chat-open": { second: button("chat-open"), shown: `!document.querySelector('[data-chat-open-demo]')` },
  "chat-typing": { second: button("chat-typing"), shown: `!document.querySelector('[data-typing]')` },
  "part-change": { second: button("part-change"), shown: `!!document.querySelector('[data-part="Spend"][data-part-state="loading"]')` },
  "value-change": { second: button("value-change"), shown: `document.querySelector('[data-part="Spend"] [data-count]')?.dataset.count === "16.35"` },
};

async function fresh(page: import("@playwright/test").Page, m?: Motion) {
  await page.goto("/design");
  // the page draws its parts a moment after it loads
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  if (m)
    await page
      .locator(SHOWS[m].at)
      .first()
      .evaluate((el) => el.scrollIntoView({ block: "center" }));
  // the parts that just drew have their own short change to finish
  await page.waitForFunction(() => document.getAnimations().every((a) => a.id !== "part-change"));
  await page.waitForTimeout(100);
}

test("every part in every state, at this width", async ({ page }) => {
  await shotEveryState(page, "/design", "design");
});

test.describe("motion", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "motion is measured once, at 1440 px");

  test("nothing moves at rest, not even a task that waits for you", async ({ page }) => {
    await fresh(page);
    expect(await running(page)).toEqual([]);
    await page.waitForTimeout(2500);
    expect(await running(page)).toEqual([]);
  });

  test("an answer clears the signal at once, the train pulls away, and then the item leaves", async ({ page }) => {
    await fresh(page, "inbox-clear");
    await press(page, '[data-key="i1"] button');
    expect(await page.evaluate(() => document.querySelector('[data-key="i1"] [data-inbox-signal]')?.getAttribute("data-inbox-signal"))).toBe("clear");
    expect([...new Set((await running(page)).map((a) => a.id))]).toEqual(["inbox-clear"]);
    await expect(page.locator('[data-key="i1"]')).toHaveCount(0);
    await page.waitForFunction(() => document.getAnimations().every((a) => a.id !== "part-change"));
    expect(await running(page)).toEqual([]);
  });

  liveMotionTests({
    moves: NAMES.map((m) => [m, { m, after: SHOWS[m].after }]),
    immediate: true,
    fresh: (page, live) => fresh(page, live.m),
    act: (page, live) => press(page, button(live.m)),
    click: (page, m) => clickMidMotion(page, button(m), MID[m].second, MID[m].shown, MOTIONS[m].ms / 2),
  });
});

test.describe("focus and press", () => {
  /** The ring the token makes, as the browser computes it. */
  const RING = `(() => {
    const d = document.body.appendChild(document.createElement("div"));
    d.style.cssText = "outline: var(--lc-ring); outline-offset: var(--lc-ring-offset)";
    const s = getComputedStyle(d);
    const r = [s.outlineStyle, s.outlineWidth, s.outlineColor, s.outlineOffset].join(" ");
    d.remove();
    return r;
  })()`;

  test("tabbing through the page, every focusable part shows the one ring", async ({ page }) => {
    await fresh(page);
    const ring = await page.evaluate(RING);
    expect(ring).toBe("solid 2px rgb(217, 119, 87) 2px");
    const seen: string[] = [];
    for (let i = 0; i < 400; i++) {
      await page.keyboard.press("Tab");
      const at = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement;
        if (!e || e === document.body) return null;
        const s = getComputedStyle(e);
        const name = `${e.tagName.toLowerCase()}${e.getAttribute("role") ? `[${e.getAttribute("role")}]` : ""} "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30)}"`;
        return {
          first: e.dataset.ringSeen === "1",
          name,
          ring: [s.outlineStyle, s.outlineWidth, s.outlineColor, s.outlineOffset].join(" "),
          mark: (e.dataset.ringSeen = "1"),
        };
      });
      if (!at || at.first) break;
      expect(at.ring, at.name).toBe(ring);
      seen.push(at.name);
    }
    // links, buttons, tabs, fields and card links, each once
    expect(seen.length).toBeGreaterThan(20);
    for (const kind of ["a ", "button ", "button[tab] ", "input "])
      expect(
        seen.some((s) => s.startsWith(kind)),
        kind,
      ).toBe(true);
  });

  test("every button, tab and card link shows its press within 100 ms", async ({ page, hasTouch }) => {
    test.setTimeout(240_000); // it presses every part on the page, one by one
    await fresh(page);
    // a tap where the page has touch (390 px), a click where it does not
    const cdp = hasTouch ? await page.context().newCDPSession(page) : undefined;
    const touch = (type: "touchStart" | "touchCancel", at?: { x: number; y: number }) =>
      cdp!.send("Input.dispatchTouchEvent", { type, touchPoints: at ? [{ x: at.x, y: at.y }] : [] });
    await page.evaluate(() => {
      (window as any).pressed = [];
      // the frame after a press starts: what the pressed part looks like then, and how long it took
      document.addEventListener(
        "pointerdown",
        (ev) => {
          const t0 = performance.now();
          const e = (ev.target as Element).closest("a[href], button, [role=tab]") as HTMLElement;
          requestAnimationFrame(() => {
            const s = getComputedStyle(e);
            (window as any).pressed.push({ ms: performance.now() - t0, scale: s.scale, filter: s.filter });
          });
        },
        true,
      );
    });
    const parts = page.locator('button:not(:disabled):visible, [role="tab"]:visible, a[data-browser]:visible');
    const n = await parts.count();
    expect(n).toBeGreaterThan(20);
    for (let i = 0; i < n; i++) {
      const box = await parts.nth(i).evaluate((e) => {
        e.scrollIntoView({ block: "center" });
        const r = e.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (cdp) await touch("touchStart", box);
      else {
        await page.mouse.move(box.x, box.y);
        await page.mouse.down();
      }
      await page.waitForFunction((k) => (window as any).pressed.length > k, i);
      // let go away from it, so the press does nothing else
      if (cdp) await touch("touchCancel");
      else {
        await page.mouse.move(1, 1);
        await page.mouse.up();
      }
    }
    const pressed: { ms: number; scale: string; filter: string }[] = await page.evaluate(() => (window as any).pressed);
    expect(pressed).toHaveLength(n);
    for (const p of pressed) {
      expect(p.ms).toBeLessThan(100);
      expect(p.scale).toBe("0.97");
      expect(p.filter).toBe("brightness(0.8)");
    }
  });
});
