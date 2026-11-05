// The parts of the app at rest against the board's (U41): each part is drawn from `ui/brand/rail.ts` and from the
// board's own picture, both cut to their ink and compared pixel by pixel. The difference stays under the "Parts
// threshold" in docs/design.md.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import * as part from "../brand/rail.ts";
import { BOARD_URL } from "./alike.ts";

const DESIGN = readFileSync(join(import.meta.dirname, "..", "..", "docs", "design.md"), "utf8");
const limit = Number(/Parts threshold: (\d+(?:\.\d+)?) %/.exec(DESIGN)?.[1] ?? Number.NaN) / 100;
const SIDE = 48;

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const draw = (shapes: part.Shape[]): string =>
  shapes
    .map(
      (s) =>
        `<${s.tag} ${Object.entries(s.a)
          .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
          .join(" ")}>${draw(s.kids ?? [])}</${s.tag}>`,
    )
    .join("");
const appSvg = (shapes: part.Shape[], box: number[]) => `<svg ${NS} viewBox="${box.join(" ")}">${draw(shapes)}</svg>`;

/** A picture cut to its ink and fitted to a square: the grey of every pixel, where nothing painted is the base. */
async function ink(svg: string): Promise<Buffer> {
  const big = await sharp(Buffer.from(svg), { density: 600 }).flatten({ background: part.INK.base }).trim({ threshold: 12 }).toBuffer();
  return sharp(big).resize(SIDE, SIDE, { fit: "contain", background: part.INK.base }).greyscale().raw().toBuffer();
}

const difference = (a: Buffer, b: Buffer) => a.reduce((sum, v, i) => sum + Math.abs(v - (b[i] ?? 0)), 0) / a.length / 255;

// The board draws these parts in a row of 172 px: each is cut out by its x and y.
const BOARD = [
  { name: "Station, done", row: "Station", cut: "94 8 20 20", app: appSvg(part.station("done", part.hex, 7), [-8, -8, 16, 16]) },
  { name: "Station, at work", row: "Station", cut: "54 8 20 20", app: appSvg(part.station("work", part.hex, 7), [-8, -8, 16, 16]) },
  { name: "Station, ahead", row: "Station", cut: "14 8 20 20", app: appSvg(part.station("ahead", part.hex, 7), [-8, -8, 16, 16]) },
  { name: "Signal, clear", row: "Signal", cut: "55 0 18 40", app: appSvg(part.signal("clear", part.hex), [-8, -34, 16, 34]) },
  { name: "Signal, waits", row: "Signal", cut: "95 0 18 40", app: appSvg(part.signal("caution", part.hex), [-8, -34, 16, 34]) },
  { name: "Train", row: "Train", cut: "56 8 36 20", app: appSvg(part.train("work", part.hex, { w: 28 }), [-16, -8, 32, 16]) },
  { name: "Signal box", row: "Signal box", cut: "60 0 52 40", app: appSvg(part.signalBox(part.hex, { w: 28, h: 20, ink: "fg2" }), [-22, -24, 44, 36]) },
];

test("the parts at rest look like the board's", async ({ page }, info) => {
  test.skip(info.project.name !== "1440", "a part does not depend on the width");
  expect(limit, "docs/design.md has no 'Parts threshold: N %' line").toBeGreaterThan(0);
  await page.goto(BOARD_URL);
  const over: string[] = [];
  for (const b of BOARD) {
    const svg = await page.evaluate((row) => {
      const found = [...document.querySelectorAll("#partlist .part")].find((p) => p.querySelector("b")?.textContent === row);
      return (found?.querySelector("svg") as SVGElement | null)?.outerHTML ?? "";
    }, b.row);
    const cut = svg
      .replace(/ width="\d+"/, "")
      .replace(/ height="\d+"/, "")
      .replace(/ viewBox="[^"]*"/, "")
      .replace("<svg", `<svg ${NS} viewBox="${b.cut}"`);
    const d = difference(await ink(cut), await ink(b.app));
    console.log(`${b.name} differs ${(d * 100).toFixed(1)} %`);
    if (d > limit) over.push(`${b.name} ${(d * 100).toFixed(1)} %`);
  }
  expect(over, `parts differ from the board by more than ${limit * 100} %`).toEqual([]);
});
