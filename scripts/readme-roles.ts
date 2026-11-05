// Writes docs/readme/roles.svg, the README's chart of who does what, in CSS animation that GitHub shows (no script).
// One request in one project goes through every role as a message along the arrows: you ask the Dispatcher, the
// Planner writes the steps, plain code starts them, workers build them side by side, another company's AI reviews,
// checks pass and the step merges, a real decision reaches you, and you ask where things stand.
// `bun scripts/readme-roles.ts` writes it; `--at <seconds>` prints one paused frame instead, for screenshots.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RoleName } from "../ui/brand/roles.ts";
import { hex, station, svgOf } from "../ui/brand/rail.ts";
import { C, icon, IN, INOUT, motion, type Move, type Scene, starts, text } from "./svg-motion.ts";

export const SCENES: Scene[] = [
  { label: "YOU ASK", caption: "You tell the Dispatcher what you want.", dur: 4.5 },
  { label: "THE PLAN", caption: "The Planner writes the steps. You approve.", dur: 6 },
  { label: "THE ORDER", caption: "Plain code starts each ready step. No AI.", dur: 4.5 },
  { label: "WORKERS", caption: "Each step gets its own worker.", dur: 5 },
  { label: "REVIEW", caption: "An AI from another company reviews it.", dur: 5.5 },
  { label: "MERGED", caption: "Checks pass. It merges to GitHub.", dur: 4.5 },
  { label: "YOUR CALL", caption: "Only a real decision reaches you.", dur: 5.5 },
  { label: "STATUS", caption: "The Dispatcher knows where things stand.", dur: 5 },
];
const START = starts(SCENES);
export const LENGTH = START[SCENES.length - 1]! + SCENES[SCENES.length - 1]!.dur + 0.8;

const { track, window_, pulse, reset, chrome, page } = motion(LENGTH);
const at = (scene: number, dt = 0) => START[scene]! + dt;
const end = (scene: number) => (scene === SCENES.length - 1 ? LENGTH : START[scene + 1]!);

// Where each role stands: you on the left, the Dispatcher and the plan along the top, the workers' lanes under the
// plan, the reviewer and GitHub on the right. The Planner and the Inbox are labels, not roles of their own here.
const YOU = { x: 64, y: 180 };
const DISP = { x: 262, y: 180 };
const PLANNER = { x: 262, y: 250 };
const ROAD = { x: 494, y: 180 };
const TRUNK = 420;
const LANES = [300, 356, 412];
const LANE_END = 540;
const RIGHT = 610;
const REVIEW = { x: RIGHT, y: LANES[0]! };
const MAIN = { x: RIGHT, y: 440 };
const INBOX = { x: 64, y: 330 };
const CARD = { x: 16, y: 372 };

const box = (cx: number, cy: number, w: number, h: number, stroke: string = C.line2, extra = "") =>
  `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="12" fill="${C.raised}" stroke="${stroke}" stroke-width="2"${extra}/>`;
const node = (cx: number, cy: number, w: number, role: RoleName, label: string, size = 15) =>
  box(cx, cy, w, 44) + icon(role, cx - w / 2 + 12, cy - 9, 18, C.fg) + text(cx - w / 2 + 38, cy + 5, label, size, C.fg, ` font-weight="700"`);
const pill = (cx: number, cy: number, w: number, role: RoleName, label: string) =>
  `<rect x="${cx - w / 2}" y="${cy - 14}" width="${w}" height="28" rx="14" fill="none" stroke="${C.line2}" stroke-width="1.5" stroke-dasharray="4 4"/>` +
  icon(role, cx - w / 2 + 12, cy - 7, 14, C.fg2) +
  text(cx - w / 2 + 32, cy + 5, label, 13, C.fg2, ` font-weight="600"`);

/** A line drawn faint all the time, and lit in `colour` while its scene uses it. */
function edge(d: string, lit?: [number, number], colour: string = C.accent, dashed = false): string {
  let out = `<path d="${d}" stroke="${C.line2}" stroke-width="2" fill="none"${dashed ? ` stroke-dasharray="4 5"` : ""}/>`;
  if (lit) {
    const cls = track({ opacity: "0", "stroke-dashoffset": "1" }, [
      { at: lit[0], dur: 0.1, to: { opacity: "1" } },
      { at: lit[0], dur: 0.7, to: { "stroke-dashoffset": "0" }, ease: INOUT },
      { at: lit[1] - 0.4, dur: 0.4, to: { opacity: "0" }, ease: IN },
    ]);
    out += `<path class="${cls}" d="${d}" pathLength="1" stroke="${colour}" stroke-width="2.5" fill="none" stroke-dasharray="1" stroke-dashoffset="1" opacity="0"/>`;
  }
  return out;
}

/** A message bubble that slides from (x0, y0) to (x, y), stays until `gone`, and fades. With `keep` it stays to the
 * end of the loop and shows in the still poster. */
function bubble(label: string, x0: number, y0: number, x: number, y: number, t: number, gone: number, colour: string = C.fg, keep = false): string {
  const w = Math.round(label.length * 6.9 + 26);
  const moves: Move[] = [
    { at: t, dur: 0.3, to: { opacity: "1" } },
    { at: t, dur: 1, to: { transform: "translate(0px,0px)" }, ease: INOUT },
    ...(keep ? [] : [{ at: gone - 0.4, dur: 0.4, to: { opacity: "0" }, ease: IN }]),
  ];
  const cls = track({ opacity: "0", transform: `translate(${x0 - x}px,${y0 - y}px)` }, moves);
  return (
    `<g class="${cls}"${keep ? "" : ` opacity="0"`}><rect x="${x - w / 2}" y="${y - 13}" width="${w}" height="26" rx="13" fill="${C.base}" stroke="${colour}" stroke-width="1.5"/>` +
    text(x, y + 4.5, label, 12.5, colour, ` text-anchor="middle" font-weight="600"`) +
    `</g>`
  );
}

/** A small card under you with a question and two buttons; the first is tapped at `tap`. */
function card(title: string, line: string, yes: string, no: string, t: number, tap: number, gone: number, colour: string): string {
  const yesBox = track({ fill: C.raised, stroke: C.line2 }, [{ at: tap, dur: 0.3, to: { fill: C.clear, stroke: C.clear } }]);
  const ink = track({ fill: C.fg }, [{ at: tap, dur: 0.3, to: { fill: C.base } }]);
  const { x, y } = CARD;
  return (
    `<g class="${window_(t, gone)}" opacity="0"><rect x="${x}" y="${y}" width="224" height="84" rx="14" fill="${C.base}" stroke="${colour}" stroke-width="1.5"/>` +
    text(x + 16, y + 22, title, 13, colour, ` font-weight="700"`) +
    text(x + 16, y + 44, line, 13.5, C.fg) +
    `<rect class="${yesBox}" x="${x + 16}" y="${y + 54}" width="92" height="22" rx="8" fill="${C.raised}" stroke="${C.line2}" stroke-width="1.5"/>` +
    `<text class="${ink}" x="${x + 62}" y="${y + 69.5}" font-size="13" font-weight="700" text-anchor="middle" fill="${C.fg}">${yes}</text>` +
    `<rect x="${x + 116}" y="${y + 54}" width="92" height="22" rx="8" fill="${C.raised}" stroke="${C.line2}" stroke-width="1.5"/>` +
    text(x + 162, y + 69.5, no, 13, C.fg2, ` text-anchor="middle"`) +
    `<circle class="${pulse(tap)}" cx="${x + 62}" cy="${y + 65}" r="11" fill="none" stroke="${C.fg}" stroke-width="2" opacity="0"/></g>`
  );
}

/** A ring around a role while it acts. */
const glow = (cx: number, cy: number, w: number, h: number, from: number, until: number, colour: string = C.accent) =>
  `<g class="${window_(from, until, 0)}" opacity="0">${box(cx, cy, w + 8, h + 8, colour, ` fill="none"`).replace(`fill="${C.raised}" `, "")}</g>`;

function chart(): string {
  let out = "";
  // The lines between the roles, each lit in its scene.
  out += edge(`M${YOU.x + 26} ${YOU.y}H${DISP.x - 76}`, [at(0, 0.3), end(0)]);
  out += edge(`M${DISP.x} ${DISP.y + 22}V${PLANNER.y - 14}`, [at(1, 0.2), at(1, 2.6)], C.accent, true);
  out += edge(`M${DISP.x + 76} ${DISP.y}H${ROAD.x - 100}`, [at(1, 3.6), end(1)]);
  out += edge(`M${TRUNK} ${ROAD.y + 32}V${LANES[2]}`, [at(2, 0.6), end(2)]);
  LANES.forEach((y, i) => (out += edge(`M${TRUNK} ${y}H${LANE_END}`, [at(3, 0.2 + i * 0.4), end(3)])));
  out += edge(`M${LANE_END} ${REVIEW.y}H${RIGHT - 58}`, [at(4, 0.3), end(4)]);
  out += edge(`M${LANE_END} ${LANES[0]}C${LANE_END + 8} ${LANES[0]} ${LANE_END + 8} ${MAIN.y} ${RIGHT - 58} ${MAIN.y}`, [at(5, 0.2), end(5)], C.clear);
  out += edge(`M${TRUNK} ${LANES[1]}C${300} ${LANES[1]} ${220} ${INBOX.y} ${INBOX.x + 48} ${INBOX.y}`, [at(6, 0.2), end(6)], C.caution, true);
  out += edge(`M${INBOX.x} ${INBOX.y - 14}V${YOU.y + 30}`, [at(6, 1.4), end(6)], C.caution, true);

  // You.
  out += `<circle cx="${YOU.x}" cy="${YOU.y}" r="26" fill="${C.raised}" stroke="${C.fg2}" stroke-width="2.5"/>${icon("you", YOU.x - 13, YOU.y - 13, 26, C.fg)}`;
  out += text(YOU.x, YOU.y + 46, "You", 15, C.fg, ` text-anchor="middle" font-weight="700"`);
  // The Dispatcher, and the Planner it asks.
  out += node(DISP.x, DISP.y, 152, "dispatcher", "Dispatcher", 16).replace(`stroke="${C.line2}"`, `stroke="${C.accent}"`);
  out += pill(PLANNER.x, PLANNER.y, 108, "planner", "Planner");
  // The roadmap and its rules: three steps waiting as dots, lit once you approve them.
  out += box(ROAD.x, ROAD.y, 200, 64) + icon("roadmap", ROAD.x - 88, ROAD.y - 20, 18, C.fg) + icon("rules", ROAD.x - 66, ROAD.y - 20, 18, C.fg);
  out += text(ROAD.x - 42, ROAD.y - 6, "Roadmap and rules", 15, C.fg, ` font-weight="700"`);
  [0, 1, 2].forEach((k) => {
    const dot = track({ fill: C.raised, stroke: C.line2 }, [
      { at: at(1, 4 + k * 0.2), dur: 0.4, to: { fill: C.fg2, stroke: C.fg2 } },
      { at: at(2, 1 + k * 0.2), dur: 0.4, to: { fill: C.accent, stroke: C.accent } },
    ]);
    out += `<circle class="${dot}" cx="${ROAD.x - 50 + k * 30}" cy="${ROAD.y + 16}" r="6" fill="${C.accent}" stroke="${C.accent}" stroke-width="2"/>`;
  });
  out += `<path d="M${ROAD.x - 44} ${ROAD.y + 16}h18M${ROAD.x - 14} ${ROAD.y + 16}h18" stroke="${C.line2}" stroke-width="2"/>`;
  out += text(ROAD.x + 46, ROAD.y + 21, "steps", 12, C.fg3);
  // The workers: one per step, each on its own lane.
  LANES.forEach((y, i) => {
    const t = at(3, 0.4 + i * 0.4);
    const done = i === 0 ? at(5, 2.4) : undefined;
    const ring = track({ stroke: C.line2 }, [
      { at: t, dur: 0.4, to: { stroke: C.accent } },
      ...(done ? [{ at: done, dur: 0.4, to: { stroke: C.clear } }] : []),
    ]);
    out += `<circle class="${ring}" cx="${TRUNK + 30}" cy="${y}" r="15" fill="${C.raised}" stroke="${done ? C.clear : C.accent}" stroke-width="2"/>${icon("worker", TRUNK + 21, y - 9, 18, C.fg)}`;
    out += `<circle class="${pulse(t)}" cx="${TRUNK + 30}" cy="${y}" r="15" fill="none" stroke="${C.accent}" stroke-width="2" opacity="0"/>`;
    out += text(TRUNK + 52, y - 8, `Step ${i + 1}`, 12, C.fg2, ` font-weight="600"`);
    out += text(TRUNK + 52, y + 18, "own branch", 11, C.fg3);
  });
  out += text(TRUNK - 12, LANES[2]! + 30, "Workers", 13, C.fg2, ` font-weight="700"`);
  // The reviewer, from another company than the worker.
  out += node(REVIEW.x, REVIEW.y, 116, "reviewer", "Reviewer", 14);
  out += text(REVIEW.x, REVIEW.y + 38, "another company", 11, C.fg3, ` text-anchor="middle"`);
  // GitHub main, with the views' station, filled green when the step merges.
  out += node(MAIN.x, MAIN.y, 116, "main", "GitHub", 14);
  const [ahead, done] = (["ahead", "done"] as const).map((l) => station(l, hex, 6)[0]!.a);
  const lamp = track({ fill: String(ahead!.fill), stroke: String(ahead!.stroke) }, [
    { at: at(5, 2.4), dur: 0.4, to: { fill: String(done!.fill), stroke: String(done!.stroke) } },
  ]);
  out += svgOf([{ tag: "circle", a: { ...done!, cx: MAIN.x + 46, cy: MAIN.y, class: lamp } }]);
  out += `<circle class="${pulse(at(5, 2.4))}" cx="${MAIN.x + 46}" cy="${MAIN.y}" r="6" fill="none" stroke="${C.clear}" stroke-width="2" opacity="0"/>`;
  // The Inbox, the one way to you.
  out += pill(INBOX.x, INBOX.y, 96, "inbox", "Inbox");
  return out;
}

function story(): string {
  let out = "";
  // 1: you ask.
  out += bubble("Add CSV export to the app.", YOU.x + 60, 136, DISP.x - 40, 136, at(0, 0.5), end(0));
  out += `<circle class="${pulse(at(0, 1.6))}" cx="${DISP.x}" cy="${DISP.y}" r="26" fill="none" stroke="${C.accent}" stroke-width="2" opacity="0"/>`;
  // 2: the Planner writes the steps; the Dispatcher shows them to you; you approve; they go into the roadmap.
  out += glow(PLANNER.x, PLANNER.y, 108, 28, at(1, 0.4), at(1, 2.4));
  out += card("Approve these steps?", "3 steps, with why and done when", "Approve", "Reject", at(1, 1.6), at(1, 3.4), end(1), C.accent);
  // 3: plain code sees which steps are ready and starts them.
  out += glow(ROAD.x, ROAD.y, 200, 64, at(2, 0.2), end(2));
  out += bubble("3 steps ready: start them.", ROAD.x + 30, 230, ROAD.x + 30, 252, at(2, 0.8), end(2));
  // 5: the reviewer finds one issue, the worker fixes it, the review passes.
  out += glow(REVIEW.x, REVIEW.y, 116, 44, at(4, 0.6), end(4));
  out += bubble("1 issue", REVIEW.x, 260, 500, 262, at(4, 1), at(4, 2.8), C.fg2);
  out += bubble("Fixed", 500, 262, REVIEW.x, 260, at(4, 2.8), end(4), C.clear);
  out += `<circle class="${pulse(at(4, 4))}" cx="${REVIEW.x}" cy="${REVIEW.y}" r="22" fill="none" stroke="${C.clear}" stroke-width="2" opacity="0"/>`;
  // 6: checks pass on the way to main.
  out += bubble("Checks pass", LANE_END - 10, 340, LANE_END - 10, 392, at(5, 0.6), end(5), C.clear);
  // 7: a real decision goes through the Inbox to you, as buttons.
  out += bubble("Paid map service?", 330, 380, 190, 352, at(6, 0.4), at(6, 2), C.caution);
  out += glow(INBOX.x, INBOX.y, 96, 28, at(6, 1.2), end(6), C.caution);
  out += `<circle class="${window_(at(6, 1.6), end(6), 0)}" cx="${YOU.x}" cy="${YOU.y}" r="31" fill="none" stroke="${C.caution}" stroke-width="2.5" opacity="0"/>`;
  out += card("Shop waits for you", "Use a paid map service?", "Yes", "No", at(6, 1.8), at(6, 4), end(6), C.caution);
  // 8: you ask where things stand; the Dispatcher answers from the live status. The answer stays in the poster.
  out += bubble("Where are we?", YOU.x + 60, 136, DISP.x - 50, 136, at(7, 0.3), at(7, 2.2));
  out += bubble("1 merged, 2 at work.", DISP.x - 30, 136, YOU.x + 92, 136, at(7, 2.2), LENGTH, C.clear, true);
  return out;
}

export const ALT =
  "Who does what in Lineclear, in eight scenes. " +
  "1, you tell the Dispatcher what you want, for example: add CSV export to the app. The Dispatcher is the one you talk to. " +
  "2, the Planner writes the steps, each with why and done when. The rule checks and a fresh-eyes readiness check clear them, they go into the roadmap by themselves, and you can undo them with one tap. " +
  "3, plain code with no AI sees which steps are ready and starts them. " +
  "4, each step gets its own worker on its own branch; three workers build three steps side by side. " +
  "5, an AI from another company than the worker reviews the step and finds one issue; the worker fixes it. " +
  "6, checks pass, the step merges to main on GitHub, and its signal turns green. " +
  "7, only what leaves the machine, or a login code, reaches you, through the Inbox, as two buttons on your phone. " +
  "8, asked where things stand, the Dispatcher answers from the live status: one merged, two at work.";

export function roles(t?: number): string {
  reset();
  const body = `<g class="${track({ opacity: "1" }, [{ at: LENGTH - 0.6, dur: 0.5, to: { opacity: "0" }, ease: IN }])}">${chart()}${story()}</g>`;
  return page({ title: "Who does what in Lineclear", alt: ALT, width: 680, height: 500, body: body + chrome(SCENES, START, 476), t });
}

if (import.meta.main) {
  const i = process.argv.indexOf("--at");
  if (i > 0) process.stdout.write(roles(Number(process.argv[i + 1])));
  else {
    const out = join(import.meta.dirname, "..", "docs", "readme", "roles.svg");
    const svg = roles();
    writeFileSync(out, svg);
    console.log(`wrote ${out}: ${LENGTH.toFixed(1)} s, ${(svg.length / 1024).toFixed(1)} kB`);
  }
}
