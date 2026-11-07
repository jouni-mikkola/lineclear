import { expect, test } from "bun:test";
import { frames, html } from "./board-frames.ts";

// The board's Home frames state the work and never ask (U50). The board builds its frames in a script; run it on a
// stub page and read what it puts in each frame.

const HOME = ["home-d", "home-p", "home-clear", "home-many", "chat-d", "st-load", "st-stale", "st-long"];

test("every Home frame is built", () => {
  const f = frames();
  for (const id of HOME) expect(f[id], id).toBeTruthy();
});

test("a Home headline states the work and never says what waits for you", () => {
  const f = frames();
  for (const id of HOME) {
    if (id === "st-load") continue; // a skeleton: no words yet
    const h1 = (f[id] ?? "").match(/<h1[^>]*>(.*?)<\/h1>/)?.[1] ?? "";
    expect(h1, id).toMatch(/^Line clear\./);
    expect(h1.toLowerCase(), id).not.toContain("wait for you");
    expect(h1.toLowerCase(), id).not.toContain("waits for you");
  }
});

test("no Home frame has an ask or an answer button", () => {
  const f = frames();
  for (const id of HOME) {
    expect(f[id] ?? "", id).not.toContain("wait for you");
    expect(f[id] ?? "", id).not.toContain("card ask");
    for (const m of (f[id] ?? "").matchAll(/<a class="btn[^>]*>(?:<svg.*?<\/svg>)?([^<]*)<\/a>/g))
      expect(m[1], id).not.toMatch(/merge|hold|approve|fix|answer|decide|open/i);
  }
});

test("a task at work is a row with its state, run time and expected finish", () => {
  const f = frames();
  expect(f["home-d"] ?? "").toMatch(/Running: \d+ min/);
  expect(f["home-d"] ?? "").toContain("Done in: about");
  expect(html).toMatch(/<p class="cap">[^<]*a tap opens its step page \(U45\)/);
});

test("what waits for you is a count on the Inbox tab in the rail and the bar", () => {
  const f = frames();
  expect(f["home-d"] ?? "").toMatch(/Inbox<span class="n am">\d+<\/span>/);
  expect(f["chat-d"] ?? "").toMatch(/Inbox<span class="n am">\d+<\/span>/);
  expect(f["home-p"] ?? "").toMatch(/Inbox<span class="badge">\d+<\/span>/);
});
