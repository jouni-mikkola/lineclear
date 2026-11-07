// The UI bar on the Roadmap view (`/<project>/roadmap`), served by `lineclear run`. The pictures use the sample
// states (`?state=`, where `many` is a generated roadmap of 400 steps over 12 phases) and Lineclear's own roadmap as
// it was when the view was built; the rest reads a repo and the space's tasks that the tests change.
import { expect, type Page, test } from "@playwright/test";
import type { Motion } from "../kit/motion.ts";
import { clickAfterReread, liveMotionTests, press, reread, running, shotEveryState, TAB } from "./bar.ts";
import { breakRoadmap, ROADMAP_LIVE, startFixture, writeListRoadmap, writeShopRoadmap, writeThisRoadmap } from "./fixture.ts";

test.use({ timezoneId: "UTC" });

async function fresh(page: Page, project = "web-shop") {
  startFixture();
  writeShopRoadmap();
  writeThisRoadmap();
  // the server answers with what it last read while it reads again: past this read, the page finds the new files
  await page.waitForTimeout(1100);
  await page.request.get(`/api/roadmap/${project}`);
  await page.waitForTimeout(1100);
  await page.goto(`/${project}/roadmap/track`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("[data-step]");
  await page.waitForTimeout(1100);
}

test("the Roadmap view in every state, at this width", async ({ page }) => {
  await shotEveryState(page, "/web-shop/roadmap", "roadmap-goals");
});

test("the phase track in every state, at this width", async ({ page }) => {
  await shotEveryState(page, "/web-shop/roadmap/track", "roadmap");
});

test("the goals page has no step id and no rail, and a tap on a goal opens its phases and steps", async ({ page }) => {
  await page.goto("/web-shop/roadmap?state=filled");
  await page.waitForSelector("[data-goal]");
  await expect(page.locator("[data-goals]")).not.toContainText(/\bW\d+\b/);
  await expect(page.locator("[data-station], [data-segment]")).toHaveCount(0);
  await expect(page.locator("[data-column]").first()).toBeVisible();
  const goal = page.locator("[data-goal]").first();
  await expect(goal.locator("[data-goal-confidence]")).toBeVisible();
  await goal.getByRole("button").click();
  await expect(goal.locator("[data-goal-step]").first()).toBeVisible();
  // a decision is a link to its Inbox ask
  await expect(page.locator("[data-decision]").first()).toHaveAttribute("href", /^\/inbox\/\d+$/);
  await page.locator("[data-track-link]").click();
  await expect(page).toHaveURL(/\/web-shop\/roadmap\/track/);
  await page.waitForSelector("[data-step]");
});

test("the goals page prints on one A4 page, with 3 goals and with 12", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 1440, "one width is enough for the print");
  for (const [state, count] of [
    ["filled", 3],
    ["many", 12],
  ] as const) {
    await page.goto(`/web-shop/roadmap?state=${state}`);
    await page.waitForSelector("[data-goal]");
    expect(await page.locator("[data-goal]").count()).toBe(count);
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({ format: "A4" });
    const pages = pdf.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length;
    expect(pages, `${count} goals`).toBe(1);
    await page.emulateMedia({ media: "screen" });
  }
});

test("a link to one request's steps marks them on the roadmap, at this width", async ({ page }) => {
  await page.goto("/budget-app/roadmap/track?state=filled&plan=BUD-12");
  await page.evaluate(() => document.fonts.ready);
  const strip = page.locator("[data-plan-strip=BUD-12]");
  await expect(strip).toContainText("Add CSV export");
  await expect(strip.locator("[data-plan-step]")).toHaveCount(2);
  await expect(strip.getByRole("link", { name: "Open it" })).toHaveAttribute("href", "/inbox/7");
  await expect(strip).toHaveScreenshot("roadmap-plan.png");
  // a link to a request that is not there says so
  await page.goto("/budget-app/roadmap/track?state=filled&plan=BUD-99");
  await expect(page.locator("[data-plan-note]")).toHaveText("There is no request BUD-99.");
  // the tabs scroll in their own bar; the page is never wider than the screen
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Lineclear's own roadmap, at this width", async ({ page }) => {
  await fresh(page, "lineclear");
  await expect(page.locator("[data-answer]")).toHaveCount(0);
  // the line names a finish date that moves with the clock
  await expect(page).toHaveScreenshot("roadmap-this.png", { fullPage: true, mask: [page.locator("[data-roadmap-line]")] });
});

test("the status is short, its reason sits in Details and a card shows no result that repeats its title", async ({ page }) => {
  await fresh(page, "lineclear");
  const line = page.locator("[data-roadmap-line]");
  expect(((await line.textContent()) ?? "").length).toBeLessThan(80);
  await expect(page.locator("[data-roadmap-detail]")).toHaveCount(1);
  const cards = await page.locator("[data-step]").count();
  expect(cards).toBeGreaterThan(0);
  await expect(page.locator("[data-step] [data-result]")).toHaveCount(0);
});

test("a roadmap of Now, Next and Later lists, at this width", async ({ page }) => {
  startFixture();
  writeListRoadmap();
  await page.waitForTimeout(1100);
  await page.goto("/notes-app/roadmap/track");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("[data-step]");
  await expect(page.locator('[data-step="1"]')).toContainText("Sync notes between phone and laptop");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page).toHaveScreenshot("roadmap-lists.png", { fullPage: true });
});

test("with 319 steps nothing scrolls sideways, in every phase, at this width", async ({ page }) => {
  await page.goto("/web-shop/roadmap/track?state=many");
  await page.waitForSelector("[data-station]");
  const names = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-segment]")].map((e) => e.dataset.segment ?? ""));
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  expect(await fits()).toBe(true);
  const phone = (page.viewportSize()?.width ?? 0) < 500;
  for (let i = 0; i < 12; i++) {
    if (phone) {
      await page.locator("[data-phase-row]").click();
      await page.locator("[data-phase-pick]").nth(i).click();
    } else {
      await page.locator("[data-segment]").nth(i).click();
    }
    expect(await fits()).toBe(true);
  }
  expect(names.length === 12 || phone).toBe(true);
});

test("at a phone width the bar is a picture and one 48 px row opens the list of phases", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) > 500, "a phone width only");
  await page.goto("/web-shop/roadmap/track?state=many");
  await page.waitForSelector("[data-station]");
  await expect(page.locator("[data-segment]").first()).toBeHidden();
  const row = page.locator("[data-phase-row]");
  expect((await row.boundingBox())?.height).toBe(48);
  await expect(page.locator("[data-phase-list]")).toHaveCount(0);
  await row.click();
  await expect(page.locator("[data-phase-pick]")).toHaveCount(12);
  await page.locator('[data-phase-pick="Phase 3: Safety"]').click();
  await expect(page.locator("[data-track]")).toHaveAttribute("data-track", "Phase 3: Safety");
  await expect(page.locator("[data-phase-list]")).toHaveCount(0);
});

test("the phase bar is a track with no outline at rest, counts that add up to the summary and gaps from the 8 px scale", async ({ page }) => {
  await page.goto("/web-shop/roadmap?state=filled");
  await page.waitForSelector("[data-bar]");
  const bar = page.locator("[data-line] [data-bar]:visible");
  expect(await bar.evaluate((el) => [...el.querySelectorAll("*")].map((e) => getComputedStyle(e).outlineStyle))).not.toContain("solid");
  expect(await bar.evaluate((el) => Number.parseFloat(getComputedStyle(el).columnGap) % 8)).toBe(0);
  const labels = await page.locator("[data-segment]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  const done = labels.reduce((sum, l) => sum + Number(/(\d+) of \d+ done/.exec(l)?.[1]), 0);
  await expect(page.locator("[data-roadmap-line]")).toHaveText(new RegExp(`^${done} done`));
  const open = await page.locator("[data-segment][aria-pressed=true]").getAttribute("aria-label");
  const [, got, all] = /(\d+) of (\d+) done/.exec(open ?? "") ?? [];
  const named = page.locator("[data-open-phase] span, [data-phase-row] span").filter({ hasText: " of " });
  await expect(named.first()).toHaveText(`${got} of ${all} done`);
});

test.describe("live", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "the live view is checked once, at 1440 px");

  test("no headline: what is at work and next first, then the line of phases", async ({ page }) => {
    await fresh(page);
    await expect(page.locator("[data-answer]")).toHaveCount(0);
    await expect(page.getByText(/^Now in /)).toHaveCount(0);
    expect(await page.locator("[data-section]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.section))).toEqual(["now"]);
    await expect(page.locator('[data-section="now"] [data-step]')).toHaveText([/Pay with a saved card/, /Search that forgives typos/, /Stock alerts by mail/]);
    await expect(page.locator("[data-line] [data-station]").last()).toContainText("Gift cards");
  });

  test("a card is a title, a result and the state as a picture: no id, no lock, no words for the state", async ({ page }) => {
    await fresh(page);
    const w4 = page.locator('[data-step="W4"]');
    await expect(w4).toContainText("Stock alerts by mail");
    await expect(w4.locator("[data-result]")).toHaveText("You get a mail when a product is back in stock.");
    await expect(w4.locator("[data-pic] svg").first()).toBeVisible();
    // the id is on hover only, and the state is for a screen reader
    await expect(w4.locator("button")).toHaveAttribute("title", "W4");
    expect(await w4.textContent()).not.toMatch(/W4|checkout/);
    await expect(page.locator('[data-station="W5"] .sr-only')).toHaveText(/^ \(after [A-Z][a-z]+.*\)$/);
    await expect(page.locator('[data-step="W2"] .sr-only')).toHaveText(/at work/);
    await expect(page.locator('[data-step="W4"] .sr-only')).toHaveText(/in line/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("a click opens the whole brief in a side panel; Escape closes it", async ({ page }) => {
    await fresh(page);
    await expect(page.locator("[data-panel]")).toBeHidden();
    await page.locator('[data-step="W2"] button').click();
    const panel = page.locator("[data-panel]");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Pay with a saved card" })).toBeVisible();
    await expect(panel).toContainText("A saved card pays an order in one click.");
    const d = page.locator('[data-details="W2"]');
    await expect(d).toContainText("paying again should take one click.");
    await expect(d).toContainText("- A saved card pays in one click.");
    await expect(d).toContainText("Up to 2 rounds of review");
    await expect(d).toContainText("at work: Writing the tests");
    await expect(d).toContainText("None on main yet.");
    await expect(panel).toContainText("W2");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-panel]")).toBeHidden();
  });
});

test.describe("live 2", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "the live view is checked once, at 1440 px");

  test("phases are segments of one bar; a tap on a segment opens that phase", async ({ page }) => {
    await fresh(page);
    const segments = page.locator("[data-segment]");
    await expect(segments).toHaveCount(2);
    await expect(page.locator("[data-track]")).toHaveAttribute("data-track", "Phase 1: Checkout");
    await segments.first().click();
    await expect(page.locator("[data-track]")).toHaveAttribute("data-track", "Phase 0: Base");
    await expect(page.locator("[data-track] [data-station]")).toHaveText([/Repo and check/, /Product pages/]);
  });

  test("steps that can run side by side sit in parallel tracks that rejoin", async ({ page }) => {
    await fresh(page);
    const group = page.locator("[data-track] [data-parallel]");
    await expect(group).toHaveCount(1);
    await expect(group.locator("[data-station]")).toHaveText([/Pay with a saved card/, /Search that forgives typos/, /Stock alerts by mail/]);
    const tops = await group.locator("[data-station]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    expect(tops[0]).toBe(tops[1]);
    // Gift cards waits for two of them and comes after the group
    const after = await page.locator('[data-station="W5"]').boundingBox();
    expect(after!.y).toBeGreaterThan((await group.boundingBox())!.y);
  });

  test("the train sits on the step at work, a lamp on the step that waits for you", async ({ page }) => {
    await page.goto("/web-shop/roadmap/track?state=filled");
    await page.waitForSelector("[data-station]");
    await expect(page.locator('[data-station="W5"] [data-pic] svg')).toBeVisible();
    await expect(page.locator('[data-station="W5"] [data-signal]')).toHaveCount(0);
    await expect(page.locator('[data-station="W3"] [data-signal]')).toBeVisible();
  });

  test("a tap on a station opens its why and done when at the step's own address", async ({ page }) => {
    await fresh(page);
    await page.locator('[data-station="W4"] a').click();
    await expect(page).toHaveURL(/\/web-shop\/roadmap\/W4$/);
    await expect(page.locator('[data-step-part="gives"]')).toContainText("people come back when a product is in stock again.");
  });

  test("a search finds a step by its id, title or result, in every phase, folded or not", async ({ page }) => {
    await fresh(page);
    await page.locator("[data-step-search]").fill("repo and");
    await expect(page.locator("[data-step]")).toHaveCount(1);
    await expect(page.locator('[data-step="W0"]')).toBeVisible();
    await page.locator("[data-step-search]").fill("w5");
    await expect(page.locator('[data-step="W5"]')).toBeVisible();
    await page.locator("[data-step-search]").fill("one click");
    await expect(page.locator('[data-step="W2"]')).toBeVisible();
    await page.locator("[data-step-search]").fill("nothing like it");
    await expect(page.getByText('No step matches "nothing like it".')).toBeVisible();
    await page.locator("[data-step-search]").fill("");
    await expect(page.locator("[data-line]")).toBeVisible();
  });

  test("Lineclear's own roadmap shows within 1 s of a first load, read before it is asked for", async ({ page }) => {
    await fresh(page, "lineclear");
    await page.goto("/");
    await page.addInitScript(() => {
      new MutationObserver(() => ((window as any).shown ??= document.querySelector("[data-step]") ? performance.now() : undefined)).observe(document, {
        subtree: true,
        childList: true,
      });
    });
    await page.goto("/lineclear/roadmap/track");
    await page.waitForSelector("[data-step]");
    const shown = await page.evaluate(() => (window as any).shown as number);
    console.log(`roadmap first load: steps at ${Math.round(shown)} ms`);
    expect(shown).toBeLessThan(1000);
  });
});

test.describe("live 3", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "the live view is checked once, at 1440 px");

  test("Home links a project to its roadmap", async ({ page }) => {
    await fresh(page);
    await page.goto("/");
    await page.locator('main a[href="/web-shop/roadmap"]').first().click();
    await expect(page).toHaveURL(/\/web-shop\/roadmap$/);
    await expect(page.locator("[data-goal]").first()).toBeVisible();
    // a page under its project: one link of the navigation is the one you are on, and a link goes back to Home
    await expect(page.locator('nav[aria-label="Views"] a[aria-current]:visible')).toHaveCount(1);
    await page.locator("[data-back]").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  });

  test("a link changes the view in place: the page keeps its values, back and forward keep the scroll place", async ({ page }) => {
    await fresh(page);
    await page.setViewportSize({ width: 1440, height: 400 });
    await page.goto("/");
    await page.waitForSelector('main a[href="/web-shop/roadmap"]');
    await page.evaluate(() => ((window as any).kept = "still here"));
    const kept = () => page.evaluate(() => (window as any).kept);
    const place = () => page.evaluate(() => Math.round(scrollY));
    const home = await page.evaluate(() => (scrollTo(0, 120), Math.round(scrollY)));
    expect(home).toBeGreaterThan(0);

    await press(page, 'nav a[href="/web-shop/roadmap"]:visible');
    expect(await running(page).then((r) => r.map((a) => a.id))).toContain("view-change");
    await expect(page).toHaveURL(/\/web-shop\/roadmap$/);
    await expect(page.locator("[data-goal]").first()).toBeVisible();
    expect(await place()).toBe(0);
    const roadmap = await page.evaluate(() => (scrollTo(0, 300), Math.round(scrollY)));
    expect(roadmap).toBeGreaterThan(0);

    await page.goBack();
    await expect(page.locator('main a[href="/web-shop/roadmap"]').first()).toBeVisible();
    expect(await place()).toBe(home);
    await page.goForward();
    await expect(page.locator("[data-goal]").first()).toBeVisible();
    expect(await place()).toBe(roadmap);
    expect(await kept()).toBe("still here");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await press(page, TAB("/"));
    await expect(page).toHaveURL(/\/$/);
    expect(await running(page)).toEqual([]);
    expect(await kept()).toBe("still here");
  });

  test("nothing moves at rest, while the view reads the server", async ({ page }) => {
    await fresh(page);
    await page.waitForTimeout(3500);
    expect(await running(page)).toEqual([]);
  });

  test("a roadmap that does not pass its check, and a project that does not exist, say why", async ({ page }) => {
    await fresh(page);
    // what was read stays on screen; a fresh page, once the server has read the change, says what is wrong
    await breakRoadmap(page, "## P\n\n### X1 Broken\n- why: w\n");
    await page.reload();
    await expect(page.locator('[role="alert"]')).toContainText("does not pass its check");
    await page.goto("/no-such-project/roadmap");
    await expect(page.locator('[role="alert"]')).toContainText("There is no project named no-such-project.");
  });
});

test.describe("live 4", () => {
  const change = async (page: Page, live: { change: () => void }) => {
    live.change();
    for (let i = 0; i < 50 && (await (await page.request.get("/api/roadmap/web-shop")).text()) === changeSeen; i++) await page.waitForTimeout(100);
  };
  let changeSeen = "";
  test.skip(({ viewport }) => viewport?.width !== 1440, "the live view is checked once, at 1440 px");

  test("400 steps over 12 phases draw at once and fit the width", async ({ page }) => {
    const t0 = Date.now();
    await page.goto("/web-shop/roadmap/track?state=many");
    await page.locator("[data-track]").waitFor();
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(await page.locator("[data-station]").count()).toBeGreaterThan(30);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  liveMotionTests({
    moves: Object.entries(ROADMAP_LIVE) as [Motion, NonNullable<(typeof ROADMAP_LIVE)[Motion]>][],
    fresh: (page) => fresh(page),
    // the server answers with its last read while it reads again: ask until it shows the change, so the page finds it at once
    prepare: async (_live, page) => void (changeSeen = await page.request.get("/api/roadmap/web-shop").then((r) => r.text())),
    act: async (page, live) => {
      await change(page, live);
      await page.evaluate(async (after) => {
        window.dispatchEvent(new Event("visibilitychange"));
        const done = new Function(`return ${after}`) as () => boolean;
        while (!done()) await new Promise((r) => setTimeout(r, 5));
        console.timeStamp("act");
      }, live.after);
    },
    click: async (page, m, live) => {
      await change(page, live);
      // the change reaches the page on the server's own read, which can be later than one event: wait for it
      await page.evaluate(async (after) => {
        window.dispatchEvent(new Event("visibilitychange"));
        const done = new Function(`return ${after}`) as () => boolean;
        while (!done()) await new Promise((r) => setTimeout(r, 5));
      }, live.after);
      return clickAfterReread(page, m, '[data-step="W2"] button', `!!document.querySelector('[data-panel] [data-details="W2"]')`);
    },
  });

  test("a merged step leaves at work and next, and its station turns done", async ({ page }) => {
    await fresh(page);
    ROADMAP_LIVE["task-finish"]!.change();
    await reread(page);
    await page.waitForFunction(ROADMAP_LIVE["task-finish"]!.after);
    const ids = await running(page);
    expect(ids.filter((a) => a.id === "task-finish").length).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(400);
    await expect(page.locator('[data-step="W3"]')).toHaveCount(0);
    await expect(page.locator('[data-station="W3"]')).toHaveAttribute("data-state", "done");
  });
});

test("one switch on the track sets the project Running or Paused", async ({ page }) => {
  await fresh(page);
  const sw = page.locator("[data-run-switch] button");
  await expect(sw).toHaveAttribute("data-run-state", "running");
  await sw.click();
  await expect(sw).toHaveAttribute("data-run-state", "paused");
  await expect(sw).toHaveText("Paused");
  await expect.poll(async () => (await (await page.request.get("/api/roadmap/web-shop")).json()).paused).toBe(true);
  await sw.click();
  await expect(sw).toHaveAttribute("data-run-state", "running");
});

test("the part filter shows one part's steps and each part's health as a mark with no text", async ({ page }) => {
  await page.goto("/web-shop/roadmap/track?state=filled");
  await page.waitForSelector("[data-step]");
  const chips = page.locator("[data-part-chip]");
  await expect(chips).toHaveCount(2);
  await expect(chips.first().locator("[data-part-health]")).toHaveAttribute("data-part-health", "clear");
  await expect(chips.nth(1).locator("[data-part-health]")).toHaveAttribute("data-part-health", "caution");
  const all = await page.locator("[data-step]").count();
  await chips.nth(1).click();
  const some = await page.locator("[data-step]").count();
  expect(some).toBeGreaterThan(0);
  expect(some).toBeLessThan(all);
  await chips.nth(1).click();
  await expect(page.locator("[data-step]")).toHaveCount(all);
});
