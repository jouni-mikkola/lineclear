// The taste gate's checks: what a machine can tell about finish. Each returns the faults it finds on the page as it is,
// an empty list when there are none. `ui/test/taste.pw.ts` runs them on every view and plants one fault of each kind.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

/** axe-core's serious and critical findings (colour contrast is read by contrast.pw.ts, so not twice). */
export async function axeFaults(page: Page): Promise<string[]> {
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    const r = await (window as any).axe.run(document, { rules: { "color-contrast": { enabled: false } } });
    return r.violations
      .filter((v: any) => v.impact === "serious" || v.impact === "critical")
      .map((v: any) => `${v.id}: ${v.nodes.length} x ${v.nodes[0].html.slice(0, 120)}`);
  });
}

/** What the page reports of one piece of text; it is judged outside the page, where it is easy to read. */
interface TextBox {
  label: string;
  wide: boolean;
  ellipsis: boolean;
  hidden: boolean;
  offRight: boolean;
  /** The text a truncated one shows on hover and focus, and the start of what it shows. */
  full: string | null;
  shown: string;
}

/** Text that runs out of its box or is cut off with nothing to read it in full, and a page wider than the screen. */
export async function overflowFaults(page: Page): Promise<string[]> {
  const { pageFault, boxes } = await page.evaluate(() => {
    const doc = document.documentElement;
    let pageFault: string | null = null;
    if (doc.scrollWidth > doc.clientWidth) {
      const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter(
        (e) => e.getBoundingClientRect().right > doc.clientWidth + 1 && e.checkVisibility() && !e.closest("[data-scroll], pre, svg"),
      );
      const leaf = wide.filter((e) => !wide.some((o) => o !== e && e.contains(o)));
      pageFault = `page: ${doc.scrollWidth}px wide on a ${doc.clientWidth}px screen, by ${leaf
        .slice(0, 3)
        .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)}`)
        .join(" | ")}`;
    }
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? `.${el.className.split(" ")[0]}` : ""} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
    const boxes: TextBox[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (!el.checkVisibility() || el.closest("svg, [data-scroll], pre, code, [data-allow-overflow]")) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim());
      // a one-character glyph (a cross, a dot) is cut by its own box on purpose
      if (!own || el.closest(".sr-only") || (el.textContent ?? "").trim().length < 2) continue;
      const s = getComputedStyle(el);
      const full =
        el.title ||
        el.closest("[title]")?.getAttribute("title") ||
        el.getAttribute("aria-label") ||
        el.closest("[aria-label]")?.getAttribute("aria-label") ||
        null;
      boxes.push({
        label: name(el),
        wide: el.scrollWidth > el.clientWidth + 1,
        ellipsis: s.textOverflow === "ellipsis",
        hidden: s.overflowX === "hidden" || s.overflowX === "clip",
        offRight: s.overflowX === "visible" && el.getBoundingClientRect().right > doc.clientWidth + 1,
        full,
        shown: el.innerText.trim().slice(0, 12),
      });
    }
    return { pageFault, boxes };
  });
  const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const out = pageFault ? [pageFault] : [];
  for (const b of boxes) {
    if (!b.wide) continue;
    if (b.ellipsis) {
      // truncated: the full text is on hover and focus
      if (!b.full || !flat(b.full).includes(flat(b.shown))) out.push(`truncated with no full text on hover: ${b.label}`);
    } else if (b.hidden) out.push(`clipped: ${b.label}`);
    else if (b.offRight) out.push(`runs off the screen: ${b.label}`);
  }
  return out;
}

/** Every interactive part is 44 px each way, when the screen is touched. */
export function targetFaults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(
      "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=switch], [role=checkbox]",
    )) {
      // the line's task stops sit at fixed places on a drawn track: their slot is the target (follow-up in docs/backlog.md)
      if (!el.checkVisibility() || el.closest("[data-allow-small-target], [data-task], [data-day], [data-dense]")) continue;
      // an inline link in a sentence is read by its line, not its box
      if (el.tagName === "A" && getComputedStyle(el).display === "inline") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 43.5 || r.height < 43.5)
        out.push(
          `${Math.round(r.width)}x${Math.round(r.height)}: ${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}"`,
        );
    }
    return out;
  });
}

/** Digits in tabular figures, so a column of numbers lines up and a changing number does not jiggle. */
export function numberFaults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (!el.checkVisibility() || el.closest("svg")) continue;
      const text = Array.from(el.childNodes, (n) => (n.nodeType === 3 ? n.textContent : ""))
        .join("")
        .trim();
      // a figure: a short text that is a number, with or without a unit
      if (!/^[+-]?\d[\d.,]*\s?(%|\$|€|min|h|d|s|ms|steps|tasks|\/\s?\d+)?$/.test(text)) continue;
      if (!getComputedStyle(el).fontVariantNumeric.includes("tabular-nums"))
        out.push(`${text}: ${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
    }
    return out;
  });
}

/** A relative time ("12 min ago", "in 2 h") shows the exact time on hover; a raw ISO stamp never shows. */
export function timeFaults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (!el.checkVisibility()) continue;
      const text = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join("")
        .trim();
      if (!text) continue;
      if (/\d{4}-\d\d-\d\dT\d\d:\d\d/.test(text)) out.push(`raw time: ${text.slice(0, 30)}`);
      else if (
        /\b\d+\s?(s|min|h|d|w)\s+ago\b|(·|\bfor|\bin)\s+\d+\s?(s|min|h|d|w|days?)\b|\bjust now\b|\byesterday\b/.test(text) &&
        !/\d\d?:\d\d|\d{4}/.test(el.closest("[title]")?.getAttribute("title") ?? "") &&
        !el.closest("time[datetime], [data-time]")
      )
        out.push(`relative time with no exact time on hover: ${text.slice(0, 30)}`);
    }
    return out;
  });
}

/** Text a person should not be asked to type: a shell command in a view. A part that is a terminal or a copy box is marked `data-command-ok`. */
export function commandFaults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const cmd =
      /(^|\s)(\$ |bun (run|add|install|x)\b|bunx |npm (i|install|run)\b|systemctl |curl -|sudo |lineclear (run|doctor|project|serve|update|install)\b|lineclear [a-z-]+ |git (clone|pull|push|checkout|rebase)\b|chmod |brew install)/;
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (!el.checkVisibility() || el.closest("[data-command-ok]")) continue;
      const text = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join(" ");
      if (cmd.test(text)) out.push(`command text: ${text.trim().slice(0, 50)}`);
    }
    return out;
  });
}

/** Each kind of interactive part must look different hovered, focused and pressed. */
export async function stateFaults(page: Page, touch = false): Promise<string[]> {
  const targets = await page.evaluate(() => {
    const seen = new Map<string, string>();
    const sel = "a[href], button, summary, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch]";
    document.querySelectorAll<HTMLElement>(sel).forEach((el, i) => {
      if (!el.checkVisibility() || el.closest("[data-allow-no-state]") || el.matches("[data-active], [aria-selected=true], [aria-current]")) return;
      const key = `${el.tagName}.${String(el.className)}`;
      if (seen.has(key)) return;
      el.setAttribute("data-state-probe", String(i));
      seen.set(key, `[data-state-probe="${i}"]`);
    });
    return [...seen.values()];
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
  const look = (sel: string) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement;
      const s = getComputedStyle(el);
      return [
        s.color,
        s.backgroundColor,
        s.borderColor,
        s.outlineStyle + s.outlineColor + s.outlineWidth,
        s.boxShadow,
        s.transform,
        s.opacity,
        s.filter,
        s.textDecorationLine,
      ].join("|");
    }, sel);
  const out: string[] = [];
  for (const sel of targets) {
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: sel });
    if (!nodeId) continue;
    const info = await page.evaluate((s) => {
      const e = document.querySelector(s) as HTMLButtonElement;
      return {
        label: `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 24)}"`,
        disabled: e.disabled === true,
      };
    }, sel);
    const base = await look(sel);
    // a field takes focus, not hover or press
    const field = /^(input|select|textarea)/.test(info.label);
    for (const forced of field ? ["focus-visible"] : touch ? ["focus-visible", "active"] : ["hover", "focus-visible", "active"]) {
      await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [forced] });
      const now = await look(sel);
      await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
      // a disabled part takes no hover or press
      if (now === base && !(info.disabled && forced !== "focus-visible")) out.push(`no ${forced} state: ${info.label}`);
    }
  }
  await page.evaluate(() => document.querySelectorAll("[data-state-probe]").forEach((e) => e.removeAttribute("data-state-probe")));
  await cdp.detach();
  return out;
}

/** Layout shift while a page loads or reads again: the sum of the browser's own layout-shift entries. Call it before the page opens. */
export const watchShift = (page: Page) =>
  page.addInitScript(() => {
    (window as any).__shift = 0;
    (window as any).__shiftNodes = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as any[])
        if (!e.hadRecentInput) {
          (window as any).__shift += e.value;
          for (const a of e.sources ?? [])
            (window as any).__shiftNodes.push(
              `${e.value.toFixed(4)} ${a.node?.nodeName}.${String(a.node?.className ?? "").slice(0, 40)} "${(a.node?.textContent ?? "").slice(0, 20)}"`,
            );
        }
    }).observe({ type: "layout-shift", buffered: true });
  });
export const shiftOf = (page: Page) => page.evaluate(() => Number((window as any).__shift));
export const shiftNodes = (page: Page) => page.evaluate(() => (window as any).__shiftNodes as string[]);

/** Drawn pictures keep their own geometry: the track's dashes and rail, the chart's gaps, a motion's offset. Each is named here with why. */
const DRAWN: Record<string, string[]> = {
  "ui/kit/parts.tsx": ["3px", "7px", "9px", "11px", "58px"], // the dashed track and the spend chart
  "ui/kit/chat.tsx": ["-3px"], // a motion's offset
  "ui/web/roadmap/line.tsx": ["3px"], // the track's label
  "ui/web/roadmap/chain.tsx": ["9px"], // the dot sits on the rail's centre
  "ui/kit/spend-charts.tsx": ["3px"], // the gap of the bars
  "ui/kit/settings.tsx": ["38px"], // the height of a one-line hint, so the form does not jump
  "ui/web/roadmap/goals-print.ts": ["3px", "10px", "13px"], // the print sheet's own type scale
};

/** Pixel values in the source of ui/ that are on no token: below 100 px, not 1 or 2 (lines) or a multiple of the 4 px unit. */
export function strayPixels(files: { file: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const { file, text } of files) {
    if (file.endsWith("tokens.css")) continue;
    for (const m of text.matchAll(/(?<![\w.-])(-?\d+(?:\.\d+)?)px\b/g)) {
      const n = Math.abs(Number(m[1]));
      if (n < 100 && n > 2 && n % 4 !== 0 && !DRAWN[file]?.includes(m[0])) out.push(`${file}: ${m[0]}`);
    }
  }
  return out;
}
