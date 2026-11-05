// Pages do not jump: every view opens with a layout shift of 0, cold and after a reload, and live data under an open
// view replaces only the elements whose data changed, with no blank or half drawn frame between.
import { type Page, expect, test } from "@playwright/test";
import { BASE, MACHINES, SHOP_TASKS, startFixture, startSettings, writeMachines, writeShopRoadmap, writeSpaceTasks, writeTasks } from "./fixture.ts";

const CHANGES = 4;

interface View {
  path: string;
  /** Shows when the view has drawn its data. */
  ready: string;
  /** A tap that shows the part, where it is one section among others. */
  tap?: string;
  setup: () => void;
  /** Writes the i-th version of the data. */
  change: (i: number) => void;
  /** What the view shows once it has read the i-th version; empty when the view shows none of it. */
  text: (i: number) => string;
  /** The elements that carry none of the changed data: they must stay the same nodes. */
  stable: string;
  /** The element that carries the changed data, the only place a new element may appear. */
  owner: string;
}

const title = (i: number) => `Pay with a saved card, version ${i}`;

const VIEWS: View[] = [
  {
    path: "/",
    ready: '[data-task="WEB-1"]',
    // the table sizes its columns by their text, so every version of the title is as wide as the first
    setup: () => {
      startFixture();
      writeTasks(BASE.map((t) => (t.id === "WEB-1" ? { ...t, title: title(0) } : t)));
    },
    change: (i) => writeTasks(BASE.map((t) => (t.id === "WEB-1" ? { ...t, title: title(i) } : t))),
    text: title,
    stable: '[data-task]:not([data-task="WEB-1"])',
    owner: '[data-task="WEB-1"]',
  },
  {
    path: "/settings",
    ready: "[data-machines] > [data-key]",
    tap: '[data-section="Machines to add"]',
    setup: startSettings,
    change: (i) => writeMachines(MACHINES.map((m, k) => (k === 1 ? { ...m, host: `broken-box-${i}` } : m))),
    text: (i) => `broken-box-${i}`,
    stable: '[data-machines] > [data-key="build-box"]',
    owner: "[data-machines]",
  },
  {
    path: "/web-shop/roadmap/track",
    ready: "[data-step]",
    setup: () => {
      startFixture();
      writeShopRoadmap();
    },
    change: (i) =>
      writeSpaceTasks(
        "web-shop",
        SHOP_TASKS.map((t, k) => (k === 1 ? { ...t, sub: `Writing the tests, pass ${i}` } : t)),
      ),
    text: () => "",
    stable: "[data-step]",
    owner: "[data-step]",
  },
];

type Probe = { __shifts: string[]; __bad: string[]; __foreign: string[]; __marked: number };

/** Starts watching layout shifts at the first paint; the page keeps each one as `window.__shifts`. */
const WATCH = () => {
  const w = window as unknown as Probe;
  w.__shifts = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as unknown as {
      value: number;
      hadRecentInput: boolean;
      sources?: { node?: Node; previousRect: DOMRect; currentRect: DOMRect }[];
    }[]) {
      if (e.hadRecentInput || e.value === 0) continue;
      // Three moves are not a jump: a gauge's needle, placed absolutely, is the data itself moving; and a value or label
      // that only changes width inside its own line, so its line does not move, pushes nothing above or below it.
      const flows = (n?: Node) => !(n instanceof Element) || getComputedStyle(n).position !== "absolute";
      const inline = (n?: Node) => !(n instanceof Element) || !n.children.length;
      const moved = (e.sources ?? []).some(
        (s) => flows(s.node) && (Math.abs(s.currentRect.y - s.previousRect.y) >= 1 || (!inline(s.node) && Math.abs(s.currentRect.x - s.previousRect.x) >= 1)),
      );
      if (!moved) continue;
      w.__shifts.push(
        `${e.value.toFixed(4)} ${(e.sources ?? []).map((s) => `${((s.node as Element | undefined)?.outerHTML ?? `text in ${s.node?.parentElement?.outerHTML}`)?.slice(0, 120)} x ${Math.round(s.previousRect.x)}->${Math.round(s.currentRect.x)} y ${Math.round(s.previousRect.y)}->${Math.round(s.currentRect.y)} h ${Math.round(s.previousRect.height)}->${Math.round(s.currentRect.height)}`).join(" | ")}`,
      );
    }
  }).observe({ type: "layout-shift", buffered: true });
};

const shifts = (page: Page) => page.evaluate(() => (window as unknown as Probe).__shifts);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(WATCH);
});

/** From here on, every frame is checked for a missing view or a lost element, and every new element must sit in `owner`. */
function record(args: string[]) {
  const [stable, owner] = args as [string, string];
  const w = window as unknown as Probe;
  const view = document.querySelector("[data-view]") as HTMLElement;
  const keyed = "[data-key],[data-task],[data-step]";
  if (stable) for (const el of document.querySelectorAll(stable)) (el as unknown as { __mark: boolean }).__mark = true;
  w.__marked = stable ? document.querySelectorAll(stable).length : 0;
  const lowest = { height: view.getBoundingClientRect().height, keyed: document.querySelectorAll(keyed).length };
  w.__bad = [];
  w.__foreign = [];
  new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes) if (n instanceof Element && !n.closest(owner) && !n.closest("[aria-live]")) w.__foreign.push(n.outerHTML.slice(0, 100));
  }).observe(view, { childList: true, subtree: true });
  const frame = () => {
    const now = document.querySelector("[data-view]");
    if (!now) w.__bad.push("no view");
    else {
      const h = now.getBoundingClientRect().height;
      if (h < lowest.height * 0.9) w.__bad.push(`view height ${h} under ${lowest.height}`);
      if (document.querySelectorAll(keyed).length < lowest.keyed) w.__bad.push("an element left");
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** The server reads usage from the agent's session files in the background; wait for it, so a slow machine does not decide when it lands. */
async function warmUsage(page: Page) {
  for (let i = 0; i < 40; i++) {
    if ((await (await page.request.get("/api/home")).text()).includes('"spend"')) return;
    await page.waitForTimeout(1000);
  }
}

/** Opens the view and waits until it has drawn its data. */
async function drawn(page: Page, v: View, how: "cold" | "reload" = "cold") {
  if (how === "cold") await page.goto(v.path);
  else await page.reload();
  await page.evaluate(() => document.fonts.ready);
  if (v.tap) await page.locator(v.tap).click();
  await page.waitForSelector(v.ready);
  await page.waitForTimeout(1200);
}

for (const v of VIEWS) {
  test(`${v.path}: layout shift 0 from the first paint, cold and after a reload`, async ({ page }) => {
    test.setTimeout(120_000);
    v.setup();
    await page.waitForTimeout(1100);
    await warmUsage(page);
    for (const how of ["cold", "reload"]) {
      await drawn(page, v, how as "cold" | "reload");
      expect(await shifts(page), `${v.path} ${how}`).toEqual([]);
    }
  });

  test(`${v.path}: live data replaces only what changed, in no blank frame, with layout shift 0`, async ({ page }) => {
    test.setTimeout(120_000);
    v.setup();
    await page.waitForTimeout(1100);
    await warmUsage(page);
    await drawn(page, v);
    await page.evaluate(record, [v.stable, v.owner]);
    for (let i = 1; i <= CHANGES; i++) {
      v.change(i);
      if (v.text(i)) await page.getByText(v.text(i)).first().waitFor({ state: "attached", timeout: 30_000 });
      else await page.waitForTimeout(3500);
    }
    const r = await page.evaluate((stable) => {
      const w = window as unknown as Probe;
      const still = stable ? [...document.querySelectorAll(stable)].filter((el) => (el as unknown as { __mark?: boolean }).__mark).length : 0;
      return { bad: w.__bad, foreign: w.__foreign, marked: w.__marked, still };
    }, v.stable);
    expect(r.bad).toEqual([]);
    expect(r.still, "elements that did not change are the same nodes").toBe(r.marked);
    expect(r.foreign, "new elements outside the changed one").toEqual([]);
    expect(await shifts(page)).toEqual([]);
  });
}
