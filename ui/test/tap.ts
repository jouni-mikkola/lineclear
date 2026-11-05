// U37: every link and button of every view is tapped. One that does nothing is dead, and a tap that brings a console
// error, an uncaught error or an answer of 400 or more fails. Links to other sites are not followed: they must be
// whole addresses. The frame's own links are tapped from Home only.
import { type Dialog, expect, type Page, type Request, test } from "@playwright/test";
import { isAppPath } from "../web/routes.ts";
import { writeBillingRoadmap, writeItem } from "./fixture.ts";
import { ASKED } from "./numbers.ts";
import { open, show, watch } from "./open.ts";

interface Target {
  tag: string;
  name: string;
  href: string | null;
  external: boolean;
}

// /usage is Home under its sheet, which covers the rest of Home on a phone
const reach = (path: string) => (path === "/" ? "[data-frame]" : path === "/usage" ? "[data-usage-sheet]" : "[data-view]");
const targets = (path: string) => `${reach(path)} a[href]:visible, ${reach(path)} button:visible:not([disabled])`;

const describe = (el: Element): Target => {
  const href = el.getAttribute("href");
  const url = href === null ? undefined : new URL(href, location.href);
  return {
    tag: el.tagName.toLowerCase(),
    name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40),
    href,
    external: !!url && url.origin !== location.origin,
  };
};

/** What the page does for a tap: it moves, asks the server, opens a dialog or file picker, or changes. */
async function tapAndWatch(page: Page, tap: () => Promise<void>) {
  const seen = { reacted: false, wrote: false };
  const mark = () => {
    seen.reacted = true;
  };
  const asked = (r: Request) => {
    mark();
    if (r.method() !== "GET") seen.wrote = true;
  };
  const dialog = (d: Dialog) => {
    mark();
    void d.dismiss();
  };
  page.on("request", asked);
  page.on("dialog", dialog);
  page.on("filechooser", mark);
  page.on("popup", mark);
  const from = page.url();
  await page.evaluate(() => {
    const w = window as unknown as { __changed: number };
    w.__changed = 0;
    new MutationObserver(() => w.__changed++).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await tap();
  await page.waitForTimeout(250);
  const changed = await page.evaluate(() => (window as unknown as { __changed: number }).__changed);
  page.off("request", asked);
  page.off("dialog", dialog);
  page.off("filechooser", mark);
  page.off("popup", mark);
  return { moved: page.url() !== from, reacted: seen.reacted || changed > 0, wrote: seen.wrote };
}

/** Opens the view; Home gets two asks of its own, as the fixture's may have been closed by the rules by then. */
async function opened(page: Page, path: string, marker = "") {
  await open(page, path, marker);
  if (path !== "/") return;
  writeBillingRoadmap();
  writeItem(3, ASKED);
  writeItem(4, { ...ASKED, question: "Merge the checkout branch?" });
  await expect(page.locator("[data-inbox-more]")).toBeVisible({ timeout: 5000 });
}

/** What the loop over a view's targets carries from one tap to the next. */
interface Run {
  path: string;
  touch: boolean;
  problems: string[];
  dead: string[];
  fresh: boolean;
  wrote: boolean;
}

/** Taps the target at an index. Returns false when the view has fewer targets than that. */
async function tapAt(page: Page, run: Run, i: number): Promise<boolean> {
  const { path } = run;
  // after a tap that moved or wrote, the view is opened again so the indexes stay the same
  if (run.wrote) await opened(page, path);
  else if (!run.fresh) await show(page, path);
  const el = page.locator(targets(path)).nth(i);
  if ((await page.locator(targets(path)).count()) <= i) return false;
  const t = await el.evaluate(describe, undefined, { timeout: 8000 });
  const at = `${path}: ${t.tag} "${t.name}"${t.href ? ` ${t.href}` : ""}`;
  if (t.href !== null) {
    if (t.external) {
      expect(() => new URL(t.href ?? ""), at).not.toThrow();
      return true;
    }
    const target = await el.evaluate((a) => new URL((a as HTMLAnchorElement).href).pathname);
    if (!isAppPath(target) && !target.startsWith("/api/")) run.dead.push(`${at} goes to no view`);
  }
  const before = run.problems.length;
  const r = await tapAndWatch(page, () => (run.touch ? el.tap({ timeout: 8000 }) : el.click({ timeout: 8000 }))).catch((e: Error) => {
    throw new Error(`${at} cannot be tapped: ${e.message.split("\n")[0]}`);
  });
  if (run.problems.length > before) run.problems.splice(before, 0, `after ${at}:`);
  // the Inbox address opens Home, so on Home a link to it stays where it is
  const there = new URL(t.href ?? "/", page.url()).pathname;
  const elsewhere = t.href !== null && there !== new URL(page.url()).pathname && there !== "/in" + "box";
  if (t.href !== null && !r.moved && elsewhere) run.dead.push(`${at} did not go anywhere`);
  else if (!r.reacted && !r.moved) run.dead.push(`${at} did nothing`);
  // a tap may open a sheet or a detail over the view: Escape closes it before the next target
  if (!r.moved) await page.keyboard.press("Escape");
  run.fresh = !r.moved;
  run.wrote = r.wrote;
  if (r.moved) await expect(page.locator("[data-frame]")).toBeVisible();
  return true;
}

/** One test per view: each link and button of the view is tapped. A view of many targets is split over files: this one taps every `parts`th, from number `part`. */
export function everyTap(paths: string[], part = 0, parts = 1) {
  // a graphic that never stands still cannot be tapped by a test; the motion has its own tests
  test.use({ timezoneId: "UTC", reducedMotion: "reduce" });
  for (const path of paths) {
    test(`${path}: every link and button does something and breaks nothing`, async ({ page }, info) => {
      test.setTimeout(120_000);
      const problems = watch(page);
      await opened(page, path, "");
      const first = await page.locator(targets(path)).count();
      // Usage only shows numbers
      if (path !== "/usage") expect(first, `${path} has something to tap`).toBeGreaterThan(0);
      const run: Run = { path, touch: info.project.name === "390", problems, dead: [], fresh: true, wrote: false };
      for (let i = part; i < first; i += parts) if (!(await tapAt(page, run, i))) break;
      expect(run.dead, "dead links and buttons").toEqual([]);
      expect(problems, "console errors, uncaught errors and answers of 400 or more").toEqual([]);
    });
  }
}
