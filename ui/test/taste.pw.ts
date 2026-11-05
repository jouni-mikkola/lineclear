// The taste gate (docs/design.md, "Finish"): the machine-checkable fine details on every view, on a sanitized real board
// (`?state=real`) and the long-text state; the same views in three widths into ui/test/real-shots/ for the reviewer;
// and one planted fault of each kind, which the checks must find.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  axeFaults,
  commandFaults,
  numberFaults,
  overflowFaults,
  shiftNodes,
  shiftOf,
  stateFaults,
  strayPixels,
  targetFaults,
  timeFaults,
  watchShift,
} from "./taste.ts";

export const VIEWS = ["/", "/settings", "/shop-frontend/roadmap"];
const STATES = ["real", "long"];

async function open(page: Page, path: string, state: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${path}?state=${state}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

for (const path of VIEWS) {
  for (const state of STATES) {
    test(`finish of ${path} (${state})`, async ({ page, isMobile }) => {
      await open(page, path, state);
      const faults = {
        axe: await axeFaults(page),
        overflow: await overflowFaults(page),
        numbers: await numberFaults(page),
        times: await timeFaults(page),
        commands: await commandFaults(page),
        states: await stateFaults(page, isMobile),
        ...(isMobile ? { targets: await targetFaults(page) } : {}),
      };
      expect(faults).toEqual({ axe: [], overflow: [], numbers: [], times: [], commands: [], states: [], ...(isMobile ? { targets: [] } : {}) });
    });
  }
}

// Layout shift while a page loads from the server and again when it reads the server again: nothing over 0.05 for now, 0.2 on
// Settings (its skeleton is near the final height, not equal to it). The goal is 0: docs/backlog.md.
for (const path of ["/", "/settings"]) {
  test(`${path} does not shift while loading or reading again`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await watchShift(page);
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(2500);
    expect((await shiftNodes(page)).filter((n) => Number(n.split(" ")[0]) >= (path === "/settings" ? 0.2 : 0.05))).toEqual([]);
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(1500);
    expect((await shiftNodes(page)).filter((n) => Number(n.split(" ")[0]) >= (path === "/settings" ? 0.2 : 0.05))).toEqual([]);
  });
}

// The same views on the sanitized real board at 390, 768 and 1440 px, for the reviewer to read. Not compared: the
// reviewer scores them against the checklist in docs/design.md.
test("real board pictures at three widths", async ({ page }, info) => {
  test.skip(info.project.name !== "1440", "one project takes all three widths");
  test.setTimeout(180_000);
  mkdirSync("ui/test/real-shots", { recursive: true });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of VIEWS) {
      await open(page, path, "real");
      const name = path === "/" ? "home" : path.replace(/^\//, "").replace(/\//g, "-");
      await page.screenshot({ path: `ui/test/real-shots/${name}-${width}.png`, fullPage: true });
    }
  }
});

// A planted fault of each kind: every check must find it, so a check that stops looking is caught.
test.describe("planted faults", () => {
  const plant = async (page: Page, html: string) => {
    await open(page, "/design", "filled");
    await page.evaluate((h) => document.body.insertAdjacentHTML("beforeend", h), html);
  };

  test("overflow", async ({ page }) => {
    await plant(
      page,
      `<div style="width:80px;overflow:hidden;white-space:nowrap">A title far too long to fit in its box</div><div style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Truncated with nothing to hover</div>`,
    );
    const f = await overflowFaults(page);
    expect(f.some((x) => x.startsWith("clipped"))).toBe(true);
    expect(f.some((x) => x.startsWith("truncated with no full text"))).toBe(true);
  });

  test("layout shift", async ({ page }) => {
    await watchShift(page);
    await open(page, "/design", "filled");
    const before = await shiftOf(page);
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.textContent = "late";
      d.style.height = "200px";
      document.body.prepend(d);
    });
    await page.waitForTimeout(300);
    expect(await shiftOf(page)).toBeGreaterThan(before + 0.01);
  });

  test("missing focus state", async ({ page }) => {
    await plant(
      page,
      `<style>.bare,.bare:hover,.bare:active,.bare:focus-visible{all:unset;outline:none;cursor:pointer;filter:none!important;scale:none!important}</style><button class="bare">Bare</button>`,
    );
    const f = await stateFaults(page);
    expect(f.filter((x) => x.includes('"Bare"')).map((x) => x.split(":")[0])).toEqual(expect.arrayContaining(["no hover state", "no focus-visible state"]));
  });

  test("small touch target", async ({ page }) => {
    await plant(page, `<button style="width:20px;height:20px;min-width:0;min-height:0">x</button>`);
    expect((await targetFaults(page)).some((x) => x.startsWith("20x20"))).toBe(true);
  });

  test("command text", async ({ page }) => {
    await plant(page, `<p>Run bun run check and then systemctl --user restart lineclear</p>`);
    expect((await commandFaults(page)).length).toBeGreaterThan(0);
  });

  test("number not in tabular figures, and a bare relative time", async ({ page }) => {
    await plant(page, `<span style="font-variant-numeric:normal">1,204</span><span>12 min ago</span><span>2026-10-31T11:02:00.000Z</span>`);
    expect((await numberFaults(page)).some((x) => x.startsWith("1,204"))).toBe(true);
    expect((await timeFaults(page)).length).toBe(2);
  });

  test("a serious accessibility finding", async ({ page }) => {
    await plant(page, `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`);
    expect((await axeFaults(page)).some((x) => x.startsWith("image-alt"))).toBe(true);
  });
});

// Spacing on the token grid: a pixel value in ui/ below 100 px is 1 or 2 (a line) or a multiple of the 4 px unit.
function sources(dir: string): { file: string; text: string }[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (["dist", "test", "screens", "fonts", "public", "node_modules"].includes(f)) return [];
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(tsx?|css)$/.test(f) ? [{ file: p, text: readFileSync(p, "utf8") }] : [];
  });
}

test("no stray pixel value in ui/", () => {
  expect(strayPixels(sources("ui"))).toEqual([]);
});

test("a planted stray pixel value is found", () => {
  expect(strayPixels([{ file: "ui/kit/x.tsx", text: 'className="mt-[13px] w-[16px] gap-[2px]"' }])).toEqual(["ui/kit/x.tsx: 13px"]);
});
