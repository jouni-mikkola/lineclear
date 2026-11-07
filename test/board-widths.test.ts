import { expect, test } from "bun:test";
import { frames, html } from "./board-frames.ts";

// The board is the target of the U39 review: each view has a frame at each of the four widths (U73).
const WIDTHS = [390, 768, 1440, 2560];
const NOT_VIEWS = new Set(["parts", "motion", "states"]);

test("every view of the board has frames at 390, 768, 1440 and 2560 px", () => {
  const sections = [...html.matchAll(/<section class="sec" id="([^"]+)">([\s\S]*?)<\/section>/g)];
  const views = sections.filter((s) => !NOT_VIEWS.has(s[1] as string) && (s[2] as string).includes('class="fit'));
  expect(views.length).toBeGreaterThanOrEqual(9);
  for (const [, id, body] of views) {
    const widths = new Set([...(body as string).matchAll(/class="fit[^"]*" data-w="(\d+)"/g)].map((m) => Number(m[1])));
    for (const w of WIDTHS) expect(widths.has(w), `${id} lacks ${w}`).toBe(true);
  }
});

test("every frame is built by the board's script", () => {
  const built = frames();
  for (const [, id] of html.matchAll(/class="fit[^"]*" data-w="\d+" data-h="\d+" id="([^"]+)"/g)) expect(built[id as string], id).toBeTruthy();
});

test("the Home frames show the Dispatcher chat", () => {
  const built = frames();
  for (const id of ["home-d", "home-w", "home-p", "home-t"]) expect(built[id], id).toContain('class="m dp"');
});
