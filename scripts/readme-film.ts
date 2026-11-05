// Writes docs/readme/line.svg, the README film, in CSS animation that GitHub shows (no script). Three beats tell it in
// about 14 s: the problem (you are the bottleneck), how it works (a line of stations) and the result (the line moves
// while you sleep). Each number in it is in docs/numbers.md under "README film", with its source.
// `bun scripts/readme-film.ts` writes it; `--at <seconds>` prints one paused frame instead, for screenshots.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { at as place, hex, rail as railPart, station, type StationLook, svgOf, train as trainPart } from "../ui/brand/rail.ts";
import type { RoleName } from "../ui/brand/roles.ts";
import { C, icon, IN, INOUT, motion, type Move, type Scene, starts, text } from "./svg-motion.ts";

export const SCENES: Scene[] = [
  { label: "THE PROBLEM", caption: "Many agents, one bottleneck:|you.", dur: 4 },
  { label: "HOW IT WORKS", caption: "A line of stations.|Rules start each step.", dur: 5.4 },
  { label: "THE RESULT", caption: "The line moves while you sleep.", dur: 4 },
];
const START = starts(SCENES);
/** The loop: the beats, the last one held as a pause, then a short fade to the start. */
export const LENGTH = START[SCENES.length - 1]! + SCENES[SCENES.length - 1]!.dur + 0.8;

const { track, enter, window_, pulse, reset, chrome, page } = motion(LENGTH);
const at = (scene: number, dt = 0) => START[scene]! + dt;
const end = (scene: number) => (scene === SCENES.length - 1 ? LENGTH : START[scene + 1]!);
const LAST = SCENES.length - 1;

/** One beat's group: it fades in and out with its beat. The last one is also the still poster, so it starts shown. */
const scene = (i: number, body: string) =>
  `<g class="${window_(at(i, 0.2), i === LAST ? LENGTH - 0.1 : end(i))}"${i === LAST ? "" : ` opacity="0"`}>${body}</g>`;

const rail = (d: string) => svgOf(railPart(d, hex));
const train = (x: number, y: number) => svgOf([place(x, y, trainPart("work", hex))]);
const ring = (look: StationLook, x: number, y: number) => svgOf([place(x, y, station(look, hex))]);
const roleIcon = (role: RoleName, x: number, y: number) =>
  `<circle cx="${x + 24}" cy="${y + 24}" r="32" fill="${C.raised}" stroke="${C.line2}" stroke-width="2"/>${icon(role, x, y, 48, C.fg)}`;
/** A big number with its words under it. */
const figure = (x: number, y: number, value: string, words: string, colour: string) =>
  text(x, y, value, 40, colour, ` font-weight="700" letter-spacing="-1"`) + text(x, y + 24, words, 14, C.fg2);
/** A small rail car with a project's letter. */
const chip = (x: number, y: number, letter: string) =>
  `<rect x="${x - 16}" y="${y - 16}" width="32" height="24" rx="6" fill="${C.raised}" stroke="${C.fg2}" stroke-width="1.5"/>` +
  `<circle cx="${x - 8}" cy="${y + 10}" r="2.5" fill="${C.fg3}"/><circle cx="${x + 8}" cy="${y + 10}" r="2.5" fill="${C.fg3}"/>` +
  text(x, y + 1, letter, 14, C.fg, ` text-anchor="middle" font-weight="700"`);
/** A move of a piece across the stage, eased, from `from` seconds. */
const slide = (from: number, dx: number, dy = 0, dur = 1.6): Move => ({ at: from, dur, to: { transform: `translate(${dx}px,${dy}px)` }, ease: INOUT });
/** A train that appears at `from` and runs `dx` to the right. */
const run = (from: number, x: number, y: number, dx: number, dur: number) =>
  `<g class="${track({ opacity: "0", transform: "translate(0px,0px)" }, [{ at: from, dur: 0.4, to: { opacity: "1" } }, slide(from + 0.2, dx, 0, dur)])}" opacity="0">${train(x, y)}</g>`;

// 1. Several agents, and every one of them waits for you.
function problem(): string {
  const s = at(0);
  const asks = ["waiting", "stalled", "what is next?"];
  let out = roleIcon("you", 32, 174);
  asks.forEach((ask, i) => {
    const y = 160 + i * 52;
    out += `<g class="${enter(s + 0.5 + i * 0.5)}">${rail(`M120 ${y}H240`)}${chip(176, y - 12, "ABC"[i]!)}`;
    out += `${text(264, y + 6, ask, 20, C.caution, ` font-weight="600"`)}</g>`;
  });
  return `${out}<g class="${enter(s + 2.2)}">${figure(32, 340, "143.3 min", "median wait from ready to start, without rules", C.caution)}</g>`;
}

// 2. The line: rules start it, a worker builds, a reviewer checks, it merges, and a real decision reaches you.
function how(): string {
  const s = at(1);
  const y = 196;
  const steps: [RoleName, string, string][] = [
    ["rules", "Rules", "start it"],
    ["worker", "Worker", "builds it"],
    ["reviewer", "Reviewer", "checks it"],
    ["main", "Main", "merges it"],
  ];
  let out = `<g class="${enter(s + 0.3)}">${rail(`M48 ${y}H500`)}${text(48, y - 28, "Roadmap", 14, C.fg2, ` font-weight="600"`)}</g>`;
  steps.forEach(([role, name, verb], i) => {
    const x = 96 + i * 112;
    out += `<g class="${enter(s + 0.6 + i * 0.7)}">${ring(i === 3 ? "done" : "work", x, y)}${roleIcon(role, x - 24, y + 36)}`;
    out += `${text(x, y + 124, name, 16, C.fg, ` text-anchor="middle" font-weight="700"`)}${text(x, y + 144, verb, 14, C.fg2, ` text-anchor="middle"`)}</g>`;
  });
  out += run(s + 1, 64, y, 360, 2.4);
  const tap = s + 4.2;
  const yes = track({ fill: C.accent }, [{ at: tap, dur: 0.3, to: { fill: C.clear } }]);
  out += `<g class="${enter(s + 3.2)}"><rect x="552" y="${y - 40}" width="96" height="152" rx="16" fill="${C.raised}" stroke="${C.caution}" stroke-width="1.5"/>`;
  out += `${text(600, y - 10, "Decide", 14, C.caution, ` text-anchor="middle" font-weight="700"`)}${text(600, y + 14, "paid map?", 14, C.fg2, ` text-anchor="middle"`)}`;
  out += `<rect class="${yes}" x="568" y="${y + 36}" width="64" height="32" rx="8" fill="${C.accent}"/>${text(600, y + 57, "Yes", 16, C.base, ` text-anchor="middle" font-weight="700"`)}</g>`;
  out += `<circle class="${pulse(tap)}" cx="600" cy="${y + 52}" r="12" fill="none" stroke="${C.fg}" stroke-width="2" opacity="0"/>`;
  return `${out}<g class="${enter(s + 1.8)}">${text(32, 372, "A reviewer from another company checks. Only a real decision reaches you.", 14, C.fg2)}</g>`;
}

// 3. The result: trains keep running at night, and a few questions wait for you.
function result(): string {
  const s = at(LAST);
  let out = `<g class="${enter(s + 0.4)}"><circle cx="600" cy="150" r="24" fill="${C.fg2}"/><circle cx="612" cy="142" r="22" fill="${C.base}"/></g>`;
  [150, 194, 238].forEach((y, i) => {
    out += `<g class="${enter(s + 0.4 + i * 0.3)}">${rail(`M48 ${y}H480`)}${ring("done", 448, y)}</g>`;
    out += run(s + 0.8 + i * 0.5, 112, y, 320, 2.2);
  });
  out += `<g class="${enter(s + 2.6)}">${figure(32, 336, "1.3 min", "median wait from ready to start, with rules", C.clear)}</g>`;
  out += `<g class="${enter(s + 3.2)}">${roleIcon("inbox", 360, 304)}${text(424, 328, "A few questions", 20, C.fg, ` font-weight="650"`)}${text(424, 352, "a day, from the Inbox.", 14, C.fg2)}</g>`;
  return out;
}

export const ALT =
  "How Lineclear works, in three beats drawn as a railway. " +
  "1, the problem: you run several AI agents and you are the bottleneck. They wait, stall and ask what is next. Without rules the median wait from ready to start was 143.3 minutes. " +
  "2, how it works: the roadmap is a line of stations. Rules start each step when the one before has merged. A worker builds it, a reviewer from another company checks it, and it merges to main. Only a real decision reaches you, as a button on your phone. " +
  "3, the result: the line keeps moving while you sleep, with a median wait from ready to start of 1.3 minutes, and you answer a few questions a day.";

export function film(t?: number): string {
  reset();
  // The picture fades out at the very end, before the loop starts again.
  const fade = track({ opacity: "1" }, [{ at: LENGTH - 0.6, dur: 0.5, to: { opacity: "0" }, ease: IN }]);
  const parts = [problem(), how(), result()].map((b, i) => scene(i, b)).join("\n");
  return page({ title: "How Lineclear works", alt: ALT, width: 680, height: 432, body: `<g class="${fade}">${parts}</g>${chrome(SCENES, START, 408)}`, t });
}

if (import.meta.main) {
  const i = process.argv.indexOf("--at");
  if (i > 0) process.stdout.write(film(Number(process.argv[i + 1])));
  else {
    const out = join(import.meta.dirname, "..", "docs", "readme", "line.svg");
    const svg = film();
    writeFileSync(out, svg);
    console.log(`wrote ${out}: ${LENGTH.toFixed(1)} s, ${(svg.length / 1024).toFixed(1)} kB`);
  }
}
