// The UI bar on the Chat view (`/chat`), served by `lineclear run`. The pictures use the sample states (`?state=`);
// the live tests talk to a stand-in for Lineclear's server that answers as the Dispatcher would.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { PAGE_STATES } from "./bar.ts";
import { FIXTURE, UI_PORT } from "./fixture.ts";

const CHAT_STATES = [...PAGE_STATES, "sending", "streaming", "offline", "none", "request"];
const LINECLEAR = join(FIXTURE, "lineclear");
const FAKE = UI_PORT + 1;
const fake = (path: string) => `http://127.0.0.1:${FAKE}${path}`;

// a 1 by 1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("the Chat in every state, at this width", async ({ page }) => {
  // the typing dots stand still for the picture
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const state of CHAT_STATES) {
    await page.goto(`/chat?state=${state}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector("[data-chat], [data-notice], [role=alert]");
    // every picture drawn before the shot, also those that load only as they come near
    await page.evaluate(() => Promise.all([...document.images].map((i) => ((i.loading = "eager"), i.decode().catch(() => {})))));
    // at the end of the thread, where the composer sits in its own place
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    // a phone's screen moves a stuck bar by a pixel between shots; at the end it is where it would be anyway
    await page.addStyleTag({ content: "[data-composer-bar] { position: static !important }" });
    // the thread scrolls to its newest message as it loads
    await page.waitForTimeout(500);
    await page.waitForTimeout(500);
    // the thread settles a line or two apart between runs, so its own tests read it and the picture masks it
    await expect(page).toHaveScreenshot(`chat-${state}.png`, { fullPage: true, maxDiffPixelRatio: 0.01, mask: [page.locator("[data-thread]")] });
  }
});

test("on a phone the composer stays at the bottom of the screen, and the tabs fit", async ({ page, viewport }) => {
  await page.goto("/chat?state=many");
  await page.waitForSelector("[data-thread]");
  // Home stacks its parts on a phone, so the composer sits at the end of the page and is reached by scrolling
  if ((viewport?.width ?? 0) < 1024) {
    await page.locator("[data-composer]").scrollIntoViewIfNeeded();
    await expect(page.locator("[data-composer]")).toBeInViewport({ ratio: 1 });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(wide).toBeLessThanOrEqual(0);
    return;
  }
  const box = await page.locator("[data-composer]").boundingBox();
  // above the bottom bar, where there is one
  const bars = page.locator("div.fixed[data-bar]:visible");
  const bar = (await bars.count()) ? await bars.boundingBox() : null;
  const floor = bar ? bar.y : viewport!.height;
  expect(box!.y + box!.height).toBeLessThanOrEqual(floor);
  expect(box!.y + box!.height).toBeGreaterThan(floor - 100); // Home's chat column keeps the usage mark under the composer
  // the newest message shows first
  await expect(page.locator("[data-thread] > li").last()).toBeInViewport();
  const tabs = await page.locator('nav[aria-label="Views"]:visible').evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(tabs).toBe(true);
});

/** Starts the fake Lineclear for each test of a live group and stops it after. */
function useFakeLineclear() {
  let server: ChildProcess | undefined;

  test.beforeEach(async () => {
    rmSync(LINECLEAR, { recursive: true, force: true });
    mkdirSync(LINECLEAR, { recursive: true });
    server = spawn("bun", [join(import.meta.dirname, "fake-lineclear-server.ts"), LINECLEAR, String(FAKE)], { stdio: "inherit" });
    await expect.poll(() => existsSync(join(LINECLEAR, "server.json"))).toBe(true);
  });
  test.afterEach(async () => {
    const s = server;
    server = undefined;
    if (!s || s.exitCode !== null) return;
    const gone = new Promise((ok) => s.once("exit", ok));
    s.kill();
    await gone;
  });
}

const open = async (page: Page) => {
  await page.goto("/chat");
  await page.waitForSelector('[data-chat="ready"]');
};
const actions = async () => (await (await fetch(fake("/fake/actions"))).json()) as { text: string; attachments: string[]; cid: string }[];

test.describe("live", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "the live chat is checked once, at 1440 px");
  useFakeLineclear();

  test("an example question goes with one tap, the Dispatcher writes, and its answer shows as markdown", async ({ page }) => {
    await open(page);
    await expect(page.locator("[data-chat-empty]")).toBeVisible();
    await page.locator("[data-ask]").first().click();
    await expect(page.locator('[data-who="you"]')).toHaveText(/What waits for me\?/);
    await expect(page.locator("[data-typing]")).toBeVisible();
    await expect(page.locator('[data-who="dispatcher"] strong')).toHaveText("web-shop");
    await expect(page.locator("[data-typing]")).toHaveCount(0);
    const sent = await actions();
    expect(sent.map((a) => a.text)).toEqual(["What waits for me?"]);
    expect(sent[0]!.cid).toMatch(/^[a-z0-9]+$/);
    // what was sent shows once, as the chat has it
    await expect(page.locator('[data-who="you"]')).toHaveCount(1);
  });

  test("a question card's projects are buttons: one tap answers it, once", async ({ page }) => {
    const card = {
      id: "q1",
      who: "agent",
      at: Date.now(),
      question: { id: "q1", kind: "Question", to: "agent", title: "Which project is this for?", choices: [{ label: "budget-app" }, { label: "recipes" }] },
    };
    await fetch(fake("/fake/chat"), { method: "POST", body: JSON.stringify({ messages: [card] }) });
    await open(page);
    await expect(page.locator('[data-choices="open"] [data-choice]')).toHaveCount(2);
    await page.locator('[data-choice="1"]').click();
    await expect(page.locator('[data-choices="answered"]')).toBeVisible();
    expect((await actions()).map((a: any) => [a.type, a.question, a.choice])).toEqual([["answer", "q1", 1]]);
  });
});

test.describe("live 2", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "the live chat is checked once, at 1440 px");
  useFakeLineclear();

  test("files by the button, a paste and a drop reach the Dispatcher as paths in Lineclear's inbox", async ({ page }) => {
    await open(page);
    await page.locator("[data-picker]").setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: PNG });
    await page.locator("[data-message-box]").evaluate((box, png) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new TextEncoder().encode("line one\nline two\n")], "notes.txt", { type: "text/plain" }));
      box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      const drop = new DataTransfer();
      drop.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], "dropped.png", { type: "image/png" }));
      box.dispatchEvent(new DragEvent("dragover", { dataTransfer: drop, bubbles: true, cancelable: true }));
      box.dispatchEvent(new DragEvent("drop", { dataTransfer: drop, bubbles: true, cancelable: true }));
    }, PNG.toString("base64"));
    await expect(page.locator('[data-attached="ready"]')).toHaveCount(3);
    await page.locator("[data-message-box]").fill("Here they are.");
    await page.locator("[data-send]").click();
    await expect(page.locator("[data-tray]")).toHaveCount(0);
    await expect(page.locator("[data-thread] [data-thumb]")).toHaveCount(2);
    await expect(page.locator("[data-thread] [data-file-chip]")).toHaveText(/notes\.txt/);
    const [sent] = await actions();
    expect(sent!.text).toBe("Here they are.");
    expect(sent!.attachments).toHaveLength(3);
    for (const p of sent!.attachments) expect(p).toContain("fake-lineclear-inbox-");
    expect(readFileSync(sent!.attachments[1]!, "utf8")).toBe("line one\nline two\n");
    // the thread's pictures load from Lineclear through this server
    await expect
      .poll(() =>
        page
          .locator("[data-thread] [data-thumb] img")
          .evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src.includes("/api/chat/file?") && (i as HTMLImageElement).naturalWidth > 0)),
      )
      .toEqual([true, true]);
    // a picture opens large, and closes
    await page.locator("[data-thread] [data-thumb]").first().click();
    await expect(page.locator("[data-lightbox] img")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-lightbox]")).toHaveCount(0);
  });

  test("a file too big or of a kind not taken says why, and does not go", async ({ page }) => {
    await open(page);
    await page.locator("[data-picker]").setInputFiles([
      { name: "movie.mov", mimeType: "video/quicktime", buffer: Buffer.from("not a movie") },
      { name: "huge.txt", mimeType: "text/plain", buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 97) },
    ]);
    await expect(page.locator('[data-attached="failed"]')).toHaveCount(2);
    await expect(page.locator('[data-tray] [role="alert"]').first()).toContainText("movie.mov cannot be attached");
    await expect(page.locator('[data-tray] [role="alert"]').last()).toContainText("huge.txt is too big: a file can be at most 10 MB.");
    await expect(page.locator("[data-send]")).toBeDisabled();
    await page.getByRole("button", { name: "Remove movie.mov" }).click();
    await expect(page.locator('[data-attached="failed"]')).toHaveCount(1);
  });
});

test.describe("live 3", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "the live chat is checked once, at 1440 px");
  useFakeLineclear();

  test("a message that does not go says why, and goes again with one tap under its own id", async ({ page }) => {
    await open(page);
    await page.locator("[data-message-box]").fill("fail please");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-status="failed"]')).toContainText("The Dispatcher could not take it.");
    await page.locator("[data-retry]").click();
    await expect.poll(async () => (await actions()).length).toBe(2);
    const [a, b] = await actions();
    // the same id: Lineclear takes it once, so one that did go in is not sent twice
    expect(a!.cid).toBe(b!.cid);
  });

  test("offline, it says so and does not send; back online, it sends", async ({ page, context }) => {
    await open(page);
    await context.setOffline(true);
    await expect(page.locator("[data-offline]")).toContainText("You are offline.");
    await page.locator("[data-message-box]").fill("Are you there?");
    await expect(page.locator("[data-send]")).toBeDisabled();
    await context.setOffline(false);
    await expect(page.locator("[data-offline]")).toHaveCount(0);
    await page.locator("[data-send]").click();
    await expect.poll(async () => (await actions()).map((a) => a.text)).toEqual(["Are you there?"]);
  });

  test("a new message slides in, and the page never sends from another site", async ({ page, baseURL }) => {
    await open(page);
    await fetch(fake("/fake/chat"), { method: "POST", body: JSON.stringify({ messages: [{ id: "m1", who: "agent", text: "Hello." }] }) });
    await expect(page.locator('[data-key="m1"]')).toBeVisible();
    await fetch(fake("/fake/chat"), {
      method: "POST",
      body: JSON.stringify({
        messages: [
          { id: "m1", who: "agent", text: "Hello." },
          { id: "m2", who: "agent", text: "Still here." },
        ],
      }),
    });
    const moved = await page.waitForFunction(() =>
      document
        .querySelector('[data-key="m2"]')
        ?.getAnimations()
        .some((a) => (a as Animation & { id: string }).id === "chat-arrive"),
    );
    expect(await moved.jsonValue()).toBe(true);
    const r = await fetch(`${baseURL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.com" },
      body: JSON.stringify({ text: "hi" }),
    });
    expect(r.status).toBe(403);
    expect(await actions()).toEqual([]);
  });
});
