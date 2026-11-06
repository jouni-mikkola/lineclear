import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import type { Browser, BrowserContext, CDPSession, Page } from "@playwright/test";

// What the speed budget measures in a browser (scripts/budget.ts reads the file this writes). The first view is timed at
// 390 px on the network of scripts/budgets.json; the idle numbers are one minute of two open pages, Home and a long roadmap.
const base = process.env.BUDGET_URL as string;
const pid = Number(process.env.BUDGET_PID);
const out = process.env.BUDGET_OUT as string;
const budgets = JSON.parse(readFileSync("scripts/budgets.json", "utf8"));
const IDLE_MS = 60_000;

const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } as const;

/** The server's CPU seconds and resident memory, from /proc. */
function proc(): { cpu: number; rssMb: number } {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.split(" ") ?? [];
  const ticks = Number(stat[11]) + Number(stat[12]);
  const rss = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1]);
  return { cpu: ticks / 100, rssMb: rss / 1024 };
}

interface Counted {
  bytes: number;
  scripts: number;
  homeReads: number;
  stop: () => void;
}

/** The bytes that came over the wire to a page from now on, and the scripts' share of them. */
async function count(cdp: CDPSession): Promise<Counted> {
  const c: Counted = { bytes: 0, scripts: 0, homeReads: 0, stop: () => {} };
  const kinds = new Map<string, string>();
  cdp.on("Network.requestWillBeSent", (e) => {
    if (/\/api\/home(\?|$)/.test(e.request.url)) c.homeReads++;
  });
  cdp.on("Network.responseReceived", (e) => kinds.set(e.requestId, e.type));
  cdp.on("Network.loadingFinished", (e) => {
    c.bytes += e.encodedDataLength;
    if (kinds.get(e.requestId) === "Script") c.scripts += e.encodedDataLength;
  });
  // a stream never finishes: its bytes arrive as chunks
  cdp.on("Network.dataReceived", (e) => {
    if (kinds.get(e.requestId) === "EventSource") c.bytes += e.encodedDataLength;
  });
  await cdp.send("Network.enable");
  return c;
}

const observers = `
  window.__first = { shift: 0, lcp: 0, view: 0 };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__first.shift += e.value; }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__first.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new MutationObserver((_, o) => { if (document.querySelector("[data-home] [data-line]")) { window.__first.view = performance.now(); o.disconnect(); } }).observe(document, { childList: true, subtree: true });
`;

async function open(
  browser: Browser,
  path: string,
  throttle: boolean,
  storageState?: Awaited<ReturnType<BrowserContext["storageState"]>>,
): Promise<{ page: Page; context: BrowserContext; cdp: CDPSession; counted: Counted }> {
  const context = await browser.newContext({ ...phone, baseURL: base, storageState });
  await context.addInitScript(observers);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const counted = await count(cdp);
  if (throttle) {
    const n = budgets.network;
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: n.rttMs,
      downloadThroughput: (n.downKbps * 1000) / 8,
      uploadThroughput: (n.upKbps * 1000) / 8,
    });
  }
  await page.goto(path, { waitUntil: "load" });
  return { page, context, cdp, counted };
}

test("the budget run", async ({ browser }) => {
  // the first view, on a cold cache, on the phone's network
  // the second visit of the page: the first one leaves the height of each section, so the answer grows into room that is there
  const visit = await open(browser, "/", false);
  await visit.page.waitForSelector("[data-home] [data-line]", { state: "attached" });
  await visit.page.waitForTimeout(500);
  const stored = await visit.context.storageState();
  await visit.context.close();
  const first = await open(browser, "/", true, stored);
  await first.page.waitForSelector("[data-home] [data-line]", { state: "attached" });
  await first.page.waitForTimeout(1500);
  const seen = (await first.page.evaluate("window.__first")) as { shift: number; lcp: number; view: number };
  const firstScripts = first.counted.scripts;
  await first.context.close();

  // /api/home five times, the middle one (the first fills the server's cache)
  const times: number[] = [];
  const gzipped: Record<string, string> = {};
  for (let i = 0; i < 5; i++) {
    const at = performance.now();
    const res = await fetch(`${base}/api/home`, { headers: { "accept-encoding": "gzip" } });
    await res.arrayBuffer();
    times.push(performance.now() - at);
    gzipped["/api/home"] = res.headers.get("content-encoding") ?? "";
  }
  for (const path of ["/api/inbox", "/api/settings", "/api/roadmap/web-shop", "/"]) {
    const res = await fetch(`${base}${path}`, { headers: { "accept-encoding": "gzip" } });
    await res.arrayBuffer();
    gzipped[path] = res.headers.get("content-encoding") ?? "";
  }

  // one idle minute of Home and of the long roadmap, side by side
  const home = await open(browser, "/", false);
  const roadmap = await open(browser, "/web-shop/roadmap/track", false);
  await home.page.waitForSelector("[data-home] [data-line]", { state: "attached" });
  await roadmap.page.getByText("Stock alerts by mail").first().waitFor();
  await home.page.waitForTimeout(3000);
  home.counted.bytes = 0;
  home.counted.homeReads = 0;
  roadmap.counted.bytes = 0;
  const before = proc();
  const t0 = performance.now();
  await home.page.waitForTimeout(IDLE_MS);
  const seconds = (performance.now() - t0) / 1000;
  const after = proc();
  const result = {
    firstViewMs: seen.view,
    largestPaintMs: seen.lcp,
    layoutShift: seen.shift,
    firstScriptsGzipKb: firstScripts / 1000,
    idleHomeKbPerMin: (home.counted.bytes / 1000) * (60 / seconds),
    idleRoadmapKbPerMin: (roadmap.counted.bytes / 1000) * (60 / seconds),
    homeReadsWhileIdle: home.counted.homeReads,
    homeAnswerMs: [...times].sort((a, b) => a - b)[2],
    idleCpuPercent: ((after.cpu - before.cpu) / seconds) * 100,
    idleMemoryMb: after.rssMb,
    notGzipped: Object.entries(gzipped)
      .filter(([, v]) => v !== "gzip")
      .map(([k]) => k),
  };
  writeFileSync(out, JSON.stringify(result, null, 2));
  expect(result).toBeDefined();
});
