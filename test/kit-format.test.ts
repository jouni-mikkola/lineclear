import { afterEach, describe, expect, test } from "bun:test";
import { ago, clock, count, dollars, exact, MONTHS, plural, when } from "../ui/kit/format.ts";
import * as plain from "../ui/kit/motion.ts";

const globals = globalThis as Record<string, unknown>;

describe("format", () => {
  test("count separates thousands and drops decimals", () => {
    expect(count(0)).toBe("0");
    expect(count(1234567)).toBe("1,234,567");
    expect(count(2.6)).toBe("3");
  });

  test("dollars shows cents under $100 and whole dollars from there", () => {
    expect(dollars(0.42)).toBe("$0.42");
    expect(dollars(99.999)).toBe("$100.00");
    expect(dollars(100)).toBe("$100");
    expect(dollars(1234.5)).toBe("$1,235");
  });

  test("ago names minutes, hours and days", () => {
    const now = Date.UTC(2026, 9, 31, 12);
    const before = (ms: number) => ago(now - ms, now);
    expect(before(20_000)).toBe("under a minute");
    expect(before(12 * 60_000)).toBe("12 min");
    expect(before(3 * 3_600_000)).toBe("3 h");
    expect(before(47 * 3_600_000)).toBe("47 h");
    expect(before(72 * 3_600_000)).toBe("3 days");
    expect(ago(now + 60_000, now)).toBe("under a minute");
  });

  test("plural picks the noun by count", () => {
    expect(plural(1, "task")).toBe("1 task");
    expect(plural(3, "task")).toBe("3 tasks");
    expect(plural(0, "task")).toBe("0 tasks");
    expect(plural(1200, "branch", "branches")).toBe("1,200 branches");
    expect(plural(2, "branch", "branches")).toBe("2 branches");
  });

  test("when writes a short date and a 24 hour time", () => {
    expect(when(new Date(2026, 9, 31, 11, 42).getTime())).toBe("Oct 31, 11:42");
    expect(when(new Date(2026, 0, 2, 0, 5).getTime())).toBe("Jan 2, 00:05");
  });

  test("clock writes the 24 hour time of day", () => {
    expect(clock(new Date(2026, 9, 31, 14, 5).getTime())).toBe("14:05");
    expect(clock(new Date(2026, 9, 31, 0, 0).getTime())).toBe("00:00");
  });

  test("exact reads a number and a date string as the same instant", () => {
    const at = new Date(2026, 9, 31, 11, 42).getTime();
    expect(exact(at)).toBe(exact(new Date(at).toISOString()));
    expect(exact(at)).toContain("2026");
  });

  test("MONTHS lists the twelve short names in order", () => {
    expect(MONTHS).toHaveLength(12);
    expect(MONTHS[0]).toBe("Jan");
    expect(MONTHS[11]).toBe("Dec");
    expect(MONTHS[new Date(2026, 9, 31).getMonth()]).toBe("Oct");
  });
});

interface Stand {
  firstChild: unknown;
  textContent: string;
  dataset: Record<string, string>;
  cancelled: number;
  animations: { cancel: () => void }[];
  getAnimations: () => { cancel: () => void }[];
  animate: () => unknown;
}

function standIn(): Stand {
  const el: Stand = {
    firstChild: null,
    textContent: "",
    dataset: {},
    cancelled: 0,
    animations: [],
    getAnimations: () => el.animations,
    animate: () => {
      throw new Error("no animation under reduced motion");
    },
  };
  el.animations.push({ cancel: () => el.cancelled++ }, { cancel: () => el.cancelled++ });
  return el;
}

class FakeText {
  constructor(public data: string) {}
}

let seq = 0;
// the media query is read once when motion.ts loads: the plain copy loads without one, a copy under reduced motion loads on its own
async function loadMotion(reduced: boolean) {
  globals.Text = FakeText;
  if (!reduced) return plain;
  globals.matchMedia = () => ({ matches: reduced });
  return import(`../ui/kit/motion.ts?case=${seq++}`) as Promise<typeof import("../ui/kit/motion.ts")>;
}

afterEach(() => {
  delete globals.matchMedia;
  delete globals.Text;
});

describe("motion", () => {
  test("every motion has a name and a time within 300 ms, but train-progress", async () => {
    const { MOTIONS } = await loadMotion(false);
    const names = Object.keys(MOTIONS);
    const times = Object.fromEntries(Object.entries(MOTIONS).map(([name, m]) => [name, m.ms]));
    expect(times).toEqual({
      "task-start": 280,
      "task-move": 240,
      "task-finish": 280,
      "task-wait": 280,
      "train-progress": 1200,
      "request-run": 280,
      "load-shrink": 280,
      "track-ahead": 280,
      "engine-swap": 280,
      "inbox-clear": 280,
      "inbox-arrive": 240,
      "view-change": 280,
      "chat-open": 240,
      "browser-open": 240,
      "browser-close": 240,
      "machine-add": 240,
      "machine-state": 200,
      "model-move": 200,
      "chat-arrive": 240,
      "chat-typing": 280,
      "part-change": 160,
      "value-change": 280,
    });
    expect(names.length).toBe(new Set(names).size);
    for (const [name, m] of Object.entries(MOTIONS)) {
      expect(m.what.length).toBeGreaterThan(10);
      if (name === "train-progress") expect(m.ms).toBe(1200);
      else expect(m.ms).toBeLessThanOrEqual(300);
      expect(m.ms).toBeGreaterThan(0);
    }
  });

  test("reducedMotion follows the media query", async () => {
    expect((await loadMotion(true)).reducedMotion()).toBe(true);
    expect(plain.reducedMotion()).toBe(false);
  });

  test("countTo under reduced motion writes the end value at once", async () => {
    const { countTo } = await loadMotion(true);
    const el = standIn();
    countTo(el as unknown as HTMLElement, 1, 1500, (n) => `${n} tokens`);
    expect(el.textContent).toBe("1500 tokens");
    expect(el.dataset.count).toBe("1500");
    expect(el.cancelled).toBe(2);
  });

  test("countTo with equal numbers writes the value and starts nothing", async () => {
    const { countTo } = await loadMotion(false);
    const el = standIn();
    countTo(el as unknown as HTMLElement, 7, 7, (n) => `n${n}`);
    expect(el.textContent).toBe("n7");
    expect(el.dataset.count).toBe("7");
  });

  test("countTo writes into the text node the element already owns", async () => {
    const { countTo } = await loadMotion(true);
    const el = standIn();
    const node = new FakeText("old");
    el.firstChild = node;
    countTo(el as unknown as HTMLElement, 0, 5, String);
    expect(node.data).toBe("5");
  });

  test("stop cancels every animation on the element", async () => {
    const { stop } = await loadMotion(false);
    const el = standIn();
    stop(el as unknown as Element);
    expect(el.cancelled).toBe(2);
  });

  test("play does nothing under reduced motion", async () => {
    const { play } = await loadMotion(true);
    expect(play("chat-open", standIn() as unknown as Element, [])).toBeUndefined();
  });

  test("play refuses a time over its motion's time", async () => {
    const { play } = await loadMotion(false);
    expect(() => play("chat-open", standIn() as unknown as Element, [], { ms: 5000 })).toThrow("over its");
  });
});
