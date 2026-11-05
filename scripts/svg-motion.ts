// The parts the README's animated SVGs share: the colours, the easings, the role icons as symbols, and keyframe
// tracks on one loop. GitHub shows CSS animation in an SVG but no script, so every move is a keyframe.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EASE, INK } from "../ui/brand/rail.ts";
import { ROLE_ICONS, ROLE_NAMES, type RoleName } from "../ui/brand/roles.ts";

// The colours and eases are the picture language's tokens in ui/brand/rail.ts, the same ones the views use.
export const C = INK;
const GEIST = readFileSync(join(import.meta.dir, "..", "ui", "brand", "fonts", "geist-latin.woff2")).toString("base64");

// Ease out for entrances, in for exits, in and out for moves from place to place. Nothing moves linearly.
export const OUT = EASE.out;
export const IN = EASE.in;
export const INOUT = EASE.inOut;

export type Props = Record<string, string>;
export type Move = { at: number; dur?: number; to: Props; ease?: string };

export const HID = { opacity: "0", transform: "translate(0px,8px)" };
export const SHOWN = { opacity: "1", transform: "translate(0px,0px)" };

/** Keyframe tracks on a loop of `length` seconds. `css` collects each track's rules; `reset` starts again. */
export function motion(length: number) {
  const css: string[] = [];
  let count = 0;
  const pct = (t: number) => `${+((Math.min(Math.max(t, 0), length) / length) * 100).toFixed(3)}%`;
  const body = (p: Props, ease?: string) =>
    Object.entries(p)
      .map(([k, v]) => `${k}:${v}`)
      .join(";") + (ease ? `;animation-timing-function:${ease}` : "");

  /** A class whose animation starts at `base` and makes each move in turn, holding between them. */
  function track(base: Props, moves: Move[]): string {
    const name = `a${(count++).toString(36)}`;
    let state = { ...base };
    const frames: [number, Props, string?][] = [[0, state]];
    for (const m of [...moves].sort((a, b) => a.at - b.at)) {
      const dur = m.dur ?? 0.6;
      frames.push([m.at, state, m.ease ?? OUT]);
      state = { ...state, ...m.to };
      frames.push([m.at + dur, state]);
    }
    frames.push([length, state]);
    // Two frames at one instant: the first one's values hold (moves that start together all start from it), and an
    // easing from either is kept.
    const seen = new Map<string, [Props, string?]>();
    for (const [t, p, e] of frames) {
      const had = seen.get(pct(t));
      seen.set(pct(t), had ? [had[0], had[1] ?? e] : [p, e]);
    }
    css.push(`.${name}{animation-name:${name}}@keyframes ${name}{${[...seen].map(([k, [p, e]]) => `${k}{${body(p, e)}}`).join("")}}`);
    return name;
  }
  /** Hidden, then rises 8 px into place at `at`, and stays. */
  const enter = (at: number, dy = 8) => track({ ...HID, transform: `translate(0px,${dy}px)` }, [{ at, to: SHOWN, dur: 0.7 }]);
  /** Fades in at `at` and out at `out`. */
  const window_ = (at: number, out: number, dy = 8) =>
    track({ ...HID, transform: `translate(0px,${dy}px)` }, [
      { at, to: SHOWN, dur: 0.7 },
      { at: out - 0.4, to: { opacity: "0", transform: "translate(0px,0px)" }, dur: 0.4, ease: IN },
    ]);
  /** A ring that grows and fades once at `at`. */
  const pulse = (at: number) =>
    track({ opacity: "0", transform: "scale(1)" }, [
      { at, dur: 0.05, to: { opacity: ".7" } },
      { at: at + 0.05, dur: 1.1, to: { opacity: "0", transform: "scale(2.4)" } },
    ]);
  /** A path drawn from its start (it needs pathLength="1"). */
  const draw = (at: number, dur = 0.9) => track({ "stroke-dashoffset": "1" }, [{ at, dur, to: { "stroke-dashoffset": "0" }, ease: INOUT }]);
  /** A bar that grows from its left end. */
  const grow = (at: number, dur = 0.8) => `${track({ transform: "scaleX(0)" }, [{ at, dur, to: { transform: "scaleX(1)" }, ease: INOUT }])} l`;
  const reset = () => {
    css.length = 0;
    count = 0;
  };
  /** Each scene's label and caption, and a progress bar at `barY` with one segment per scene. A `|` in a
   * caption or note breaks its line; a note is a small line under the caption. The last scene stays shown without motion, so it is the still poster. */
  function chrome(scenes: Scene[], start: number[], barY: number): string {
    let out = "";
    const end = (i: number) => (i === scenes.length - 1 ? length : start[i + 1]!);
    scenes.forEach((s, i) => {
      const gone = { at: end(i) - 0.45, dur: 0.4, to: { opacity: "0", transform: "translate(0px,0px)" }, ease: IN };
      const label = track(HID, [{ at: start[i]! + 0.05, to: SHOWN, dur: 0.6 }, gone]);
      const cap = track(HID, [{ at: start[i]! + 0.15, to: SHOWN, dur: 0.7 }, gone]);
      const hide = i === scenes.length - 1 ? "" : ` opacity="0"`;
      out += `<g class="${label}"${hide}>${text(32, 40, `${i + 1} / ${scenes.length}   ${s.label}`, 14, C.accent, ` font-weight="700" letter-spacing="1.4" xml:space="preserve"`)}</g>`;
      const lines = s.caption.split("|");
      const note = (s.note ?? "")
        .split("|")
        .filter(Boolean)
        .map((l, k) => text(32, 78 + lines.length * 30 - 4 + k * 19, l, 14, C.fg2))
        .join("");
      out += `<g class="${cap}"${hide}>${lines.map((l, k) => text(32, 78 + k * 30, l, 26, C.fg, ` font-weight="650" letter-spacing="-.3"`)).join("")}${note}</g>`;
    });
    // The current segment fills in orange, the ones before stay lit, the rest wait.
    const gap = 8;
    const w = (616 - gap * (scenes.length - 1)) / scenes.length;
    scenes.forEach((s, i) => {
      const x = +(32 + i * (w + gap)).toFixed(2);
      const last = i === scenes.length - 1;
      out += `<rect x="${x}" y="${barY}" width="${w.toFixed(2)}" height="4" rx="2" fill="${C.line}"/>`;
      const fill = track({ transform: "scaleX(0)", fill: C.accent }, [
        { at: start[i]!, dur: s.dur, to: { transform: "scaleX(1)" }, ease: INOUT },
        ...(last ? [] : [{ at: start[i]! + s.dur, dur: 0.4, to: { fill: C.fg3 } }]),
        { at: length - 0.8, dur: 0.6, to: { transform: "scaleX(0)" }, ease: IN },
      ]);
      out += `<rect class="${fill} l" x="${x}" y="${barY}" width="${w.toFixed(2)}" height="4" rx="2" fill="${last ? C.accent : C.fg3}"/>`;
    });
    return out + mark(616, 16);
  }
  /** The whole SVG. `t` pauses every animation at that second, for screenshots. */
  function page(o: { title: string; alt: string; width: number; height: number; body: string; t?: number }): string {
    const still = o.t === undefined ? "" : `*{animation-play-state:paused!important;animation-delay:-${o.t}s!important}`;
    const style =
      // The tokens' font, inside the picture: GitHub shows an SVG as an image, which loads nothing from outside.
      `@font-face{font-family:"Geist";font-weight:100 900;src:url(data:font/woff2;base64,${GEIST}) format("woff2")}` +
      `text{font-family:"Geist",ui-sans-serif,system-ui,sans-serif}` +
      `@media (prefers-reduced-motion:no-preference){[class^=a]{animation-duration:${length.toFixed(2)}s;animation-iteration-count:infinite;animation-fill-mode:both;transform-box:fill-box;transform-origin:center}` +
      `.l{transform-origin:left center}${css.join("")}${still}}`;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.width} ${o.height}" role="img" aria-labelledby="t d">`,
      `<title id="t">${esc(o.title)}</title>`,
      `<desc id="d">${esc(o.alt)}</desc>`,
      `<defs><radialGradient id="bg" cx=".45" cy=".3" r=".8"><stop offset="0" stop-color="${C.raised}"/><stop offset="1" stop-color="${C.base}"/></radialGradient>${symbols()}</defs>`,
      `<style>${style}</style>`,
      `<rect width="${o.width}" height="${o.height}" rx="20" fill="url(#bg)"/>`,
      o.body,
      `</svg>`,
      "",
    ].join("\n");
  }
  return { css, track, enter, window_, pulse, draw, grow, reset, chrome, page };
}

export type Scene = { label: string; caption: string; note?: string; dur: number };
/** When each scene starts, after a short lead in. */
export const starts = (scenes: Scene[]) =>
  scenes.reduce<number[]>((acc, _scene, i) => {
    acc.push(i ? acc[i - 1]! + scenes[i - 1]!.dur : 0.4);
    return acc;
  }, []);

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const icon = (role: RoleName, x: number, y: number, size: number, colour: string) =>
  `<use href="#i-${role}" x="${x}" y="${y}" width="${size}" height="${size}" color="${colour}"/>`;
export const text = (x: number, y: number, s: string, size: number, fill: string, extra = "") =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}"${extra}>${esc(s)}</text>`;

/** Each role's icon from ui/brand/roles.ts as a symbol in the text's colour, for `icon`. */
export function symbols(): string {
  return ROLE_NAMES.map((role) => {
    const shapes = ROLE_ICONS[role].shapes
      .map((s) =>
        "d" in s
          ? `<path d="${s.d}"/>`
          : `<circle cx="${s.circle[0]}" cy="${s.circle[1]}" r="${s.circle[2]}"${"fill" in s && s.fill ? ` fill="currentColor" stroke="none"` : ""}/>`,
      )
      .join("");
    return `<symbol id="i-${role}" viewBox="0 0 16 16"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${shapes}</g></symbol>`;
  }).join("");
}

/** The Lineclear mark, small for a corner unless `scale` says otherwise. */
export const mark = (x: number, y: number, scale = 0.5) =>
  `<g transform="translate(${x} ${y}) scale(${scale})" opacity=".9"><path fill="${C.fg}" fill-rule="evenodd" d="M5 22a17 17 0 1 0 34 0a17 17 0 1 0 -34 0ZM12 22a10 10 0 1 0 20 0a10 10 0 1 0 -20 0Z"/><circle cx="22" cy="22" r="6.5" fill="${C.accent}"/><path d="M22 38V55H57" stroke="${C.fg}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g>`;
