// Every text on the sample pages reads at 4.5:1 or more against what it sits on (WCAG AA).
import { expect, test } from "@playwright/test";

const PAGES = ["/design", "/?state=filled", "/?state=one", "/settings?state=filled", "/web-shop/roadmap?state=filled"];

for (const path of PAGES) {
  test(`text on ${path} reads at 4.5:1`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    // on a phone Settings shows its sections as rows; a tap opens one
    if (path.startsWith("/settings")) await page.locator('[data-section="Projects"]').click();
    // the page lazy-loads: wait for its content, not for a time
    await page.waitForFunction(() => (document.querySelector("main")?.textContent?.length ?? 0) > 100);
    await page.waitForTimeout(300);
    const low = await page.evaluate(() => {
      type C = [number, number, number, number];
      const parse = (s: string): C => {
        const m = s.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
        return [m[0]!, m[1]!, m[2]!, m[3] ?? 1];
      };
      const over = (top: C, under: C): C => [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])).concat(1) as C;
      const lum = (c: C) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
      };
      // the background a text sits on: each ancestor's background laid over the one below
      const backOf = (el: Element): C => {
        const layers: C[] = [];
        for (let e: Element | null = el; e; e = e.parentElement) {
          const b = parse(getComputedStyle(e).backgroundColor);
          if (b[3] > 0) layers.push(b);
          if (b[3] === 1) break;
        }
        let c: C = parse(getComputedStyle(document.body).backgroundColor);
        if (c[3] < 1) c = [11, 11, 12, 1];
        for (const l of layers.reverse()) c = over(l, c);
        return c;
      };
      const out: string[] = [];
      let read = 0;
      for (const el of document.querySelectorAll<HTMLElement>("body *")) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
        if (!own || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        const s = getComputedStyle(el);
        // disabled controls and hidden-for-screen-readers text are not read
        if (el.closest("[disabled], [aria-hidden=true], [data-skeleton]")) continue;
        read++;
        const back = backOf(el);
        const fg = over(parse(s.color), back);
        let opacity = 1;
        for (let e: Element | null = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
        const seen = over([fg[0], fg[1], fg[2], opacity], back);
        const [a, b] = [lum(seen), lum(back)].sort((x, y) => y - x);
        const ratio = (a! + 0.05) / (b! + 0.05);
        if (ratio < 4.5) out.push(`${ratio.toFixed(2)} ${s.color} "${el.textContent!.trim().slice(0, 40)}"`);
      }
      return { out, read };
    });
    // Settings on a phone shows one section at a time
    expect(low.read).toBeGreaterThan(path.startsWith("/settings") ? 10 : 20);
    expect(low.out).toEqual([]);
  });
}
