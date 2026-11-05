// The railway parts and motion tokens of Lineclear's picture language (docs/brand.md, "Picture language"). Every view
// draws them through `ui/kit/rail.tsx`, and the README films draw them through `scripts/svg-motion.ts`, so a train,
// a signal or a station looks the same everywhere. Each part is a list of plain SVG shapes around (0, 0), painted
// by name: the views paint with the CSS tokens, the README with their hex values.

/** The inks the parts use, by name, with their values from `tokens.css`. */
export const INK = {
  base: "#0b0b0c",
  raised: "#141415",
  line: "#26262a",
  line2: "#3a3a40",
  fg: "#ece9e4",
  fg2: "#a9a6a1",
  fg3: "#8f8c87",
  accent: "#d97757",
  clear: "#5fa883",
  caution: "#e7b25a",
  stop: "#e5484d",
  /** A signal's head, darker than the base. */
  dark: "#060607",
} as const;
export type Ink = keyof typeof INK;

/** How a part's ink is written: `hex` for the README, `cssVar` for the views. */
export type Paint = (ink: Ink) => string;
export const hex: Paint = (ink) => INK[ink];
export const cssVar: Paint = (ink) => (ink === "dark" ? INK.dark : `var(--lc-${ink})`);

/** One SVG shape. `kids` only for a group. */
export interface Shape {
  tag: "rect" | "circle" | "path" | "g";
  a: Record<string, string | number>;
  kids?: Shape[];
}

// Motion tokens: written by `bun run media` from scripts/film/motion.json, the one source the film reads too.
// Nothing moves linearly but the loading loop and a lamp's colour, which change at an even pace.
export const EASE = {
  /** Something arrives or settles. */
  out: "cubic-bezier(.16,1,.3,1)",
  /** Something leaves. */
  in: "cubic-bezier(.7,0,.84,0)",
  /** Something goes from one place to another, such as a train between stations. */
  inOut: "cubic-bezier(.65,0,.35,1)",
  /** A train glides from one station to the next, as the board draws it. */
  glide: "cubic-bezier(.45,0,.2,1)",
  /** A view, a lamp's track or a part settles, as the board draws it. */
  soft: "cubic-bezier(.2,.8,.2,1)",
  /** A lamp changes colour at an even pace. */
  linear: "cubic-bezier(0,0,1,1)",
} as const;
export const MS = {
  /** A lamp or a shape changes. */
  quick: 200,
  /** A train glides, a card drops in. */
  move: 240,
  /** A merge or a start: the longest a state change may take. */
  long: 280,
  /** The track being laid while a part loads, one loop. */
  lay: 1400,
} as const;
/** The key motions the app and the board share: their time, their curve and, where fixed, their keyframes. */
export const KEY = {
  /** A task's train glides to its station. */
  train: { ms: 240, ease: EASE.glide },
  /** A signal's lamp turns from amber to green. */
  lamp: { ms: 200, ease: EASE.linear, frames: [{ fill: "var(--lc-caution)" }, { fill: "var(--lc-clear)" }] },
  /** A view slides 24 px the way you went as it fades in. */
  view: { ms: 280, ease: EASE.soft, frames: [{ opacity: 0, transform: "translateX(24px)" }, { opacity: 1, transform: "none" }] },
  /** Track is laid from left to right in half the loop, then holds and fades. */
  lay: { ms: 1400, ease: EASE.linear, frames: [{ transform: "scaleX(0)", opacity: 1, offset: 0, easing: EASE.soft }, { transform: "scaleX(1)", opacity: 1, offset: 0.5 }, { transform: "scaleX(1)", opacity: 1, offset: 0.75 }, { transform: "scaleX(1)", opacity: 0, offset: 1 }] },
} as const;
// End of the motion tokens.

/** The state words of the picture language, each with its picture. */
/** A signal's lamp: dark, grey while a review checks, amber when it waits for you, green when clear, red when broken. */
export type SignalAspect = "off" | "check" | "caution" | "clear" | "stop";
export type StationLook = "ahead" | "next" | "work" | "ask" | "done";
export type TrainLook = "work" | "queued" | "stalled" | "off";

/** A rail with its sleepers along a path, `w` the rail's stroke. `tie` paints the sleepers in another ink. */
export function rail(d: string, paint: Paint, o: { w?: number; ink?: Ink; sleepers?: boolean; tie?: Ink } = {}): Shape[] {
  const w = o.w ?? 3;
  const ink = paint(o.ink ?? "line2");
  return [
    ...(o.sleepers === false
      ? []
      : [
          {
            tag: "path" as const,
            a: { d, stroke: o.tie ? paint(o.tie) : ink, "stroke-width": w * 3, "stroke-dasharray": `${(w * 2) / 3} ${(w * 7) / 3}`, fill: "none" },
          },
        ]),
    { tag: "path", a: { d, stroke: ink, "stroke-width": w, "stroke-linecap": "round", fill: "none" } },
  ];
}

/** A station: a ring on the track. Dim ahead, lit when it is next, white while a train is at it, amber when it asks, filled green once merged. */
export function station(look: StationLook, paint: Paint, r = 8): Shape[] {
  const ring: Record<StationLook, [Ink, Ink]> = {
    ahead: ["base", "line2"],
    next: ["base", "fg"],
    work: ["base", "fg"],
    ask: ["base", "caution"],
    done: ["clear", "clear"],
  };
  const [fill, stroke] = ring[look];
  return [{ tag: "circle", a: { cx: 0, cy: 0, r, fill: paint(fill), stroke: paint(stroke), "stroke-width": r * 0.375 } }];
}

/**
 * A train, nose to the right, with its head lamp. At work it is lit; in line it is an outline; stalled, dashed. With
 * `load` (0 to 1) a wagon rides behind it whose cargo is how full the worker's context is; the cargo has `data-cargo`
 * so a compaction can shrink it.
 */
export function train(look: TrainLook, paint: Paint, o: { w?: number; h?: number; load?: number } = {}): Shape[] {
  const w = o.w ?? 30;
  const h = o.h ?? 14;
  const body = { x: -w / 2, y: -h / 2, width: w, height: h, rx: h / 2 };
  const lamp = { cx: w / 2 - h * 0.43, cy: 0, r: h * 0.18 };
  const wagon = o.load === undefined || look === "queued" || look === "off" ? [] : cargo(paint, -w / 2 - WAGON.gap - WAGON.w / 2, h, o.load);
  if (look === "work") return [...wagon, { tag: "rect", a: { ...body, fill: paint("accent") } }, { tag: "circle", a: { ...lamp, fill: paint("fg") } }];
  if (look === "off") return [{ tag: "rect", a: { ...body, fill: paint("line2") } }];
  const dash: Record<string, string> = look === "stalled" ? { "stroke-dasharray": "3 3" } : {};
  return [
    ...wagon,
    {
      tag: "rect",
      a: {
        ...body,
        x: body.x + 0.75,
        y: body.y + 0.75,
        width: w - 1.5,
        height: h - 1.5,
        fill: paint("base"),
        stroke: paint("fg3"),
        "stroke-width": 1.5,
        ...dash,
      },
    },
    { tag: "circle", a: { ...lamp, fill: paint("line2") } },
  ];
}

/** The wagon behind a train: its length, and the gap of its coupling. */
const WAGON = { w: 20, gap: 4 } as const;

function cargo(paint: Paint, cx: number, h: number, load: number): Shape[] {
  const wh = h * 0.8;
  const full = load > 0.9;
  const scale = Math.max(0.04, Math.min(1, load));
  return [
    { tag: "path", a: { d: `M${cx + WAGON.w / 2} 0h${WAGON.gap}`, stroke: paint("line2"), "stroke-width": 1.5 } },
    {
      tag: "rect",
      a: {
        x: cx - WAGON.w / 2,
        y: -wh / 2,
        width: WAGON.w,
        height: wh,
        rx: 3,
        fill: paint("base"),
        stroke: paint(full ? "fg2" : "line2"),
        "stroke-width": 1.25,
      },
    },
    {
      tag: "rect",
      a: {
        x: cx - WAGON.w / 2 + 1.5,
        y: -wh / 2 + 1.5,
        width: WAGON.w - 3,
        height: wh - 3,
        rx: 1.75,
        fill: paint(full ? "fg" : "fg3"),
        "data-cargo": load,
        style: `transform-box:fill-box;transform-origin:left;transform:scaleX(${scale})`,
      },
    },
  ];
}

/** A signal: a mast that stands on the track at (0, 0) and a head with one lamp. */
export function signal(aspect: SignalAspect, paint: Paint, s = 1): Shape[] {
  const lamp: Record<SignalAspect, Ink> = { off: "line", check: "fg2", caution: "caution", clear: "clear", stop: "stop" };
  return [
    { tag: "path", a: { d: `M0 ${-6 * s}V${-18 * s}`, stroke: paint("fg3"), "stroke-width": 2 * s } },
    { tag: "rect", a: { x: -6 * s, y: -32 * s, width: 12 * s, height: 16 * s, rx: 4 * s, fill: paint("dark"), stroke: paint("line2"), "stroke-width": s } },
    { tag: "circle", a: { cx: 0, cy: -24 * s, r: 3.6 * s, fill: paint(lamp[aspect]), "data-lamp": aspect } },
  ];
}

/** The junction and the main line: the track bends into the main line, which runs on to the right for `len`. */
export function mainLine(paint: Paint, o: { len?: number; broken?: boolean; w?: number } = {}): Shape[] {
  const len = o.len ?? 40;
  const w = o.w ?? 3;
  const ink: Ink = o.broken ? "stop" : "fg2";
  return [
    { tag: "path", a: { d: `M${-12} ${-8}C${-4} ${-8} ${-4} 0 ${6} 0`, stroke: paint("line2"), "stroke-width": w, fill: "none", "stroke-linecap": "round" } },
    { tag: "path", a: { d: `M${-12} 0H${len}`, stroke: paint(ink), "stroke-width": w + 1.5, "stroke-linecap": "round", fill: "none" } },
  ];
}

/** The signal box: a cabin with a roof, where the Dispatcher sits. (0, 0) is its middle. */
export function signalBox(paint: Paint, o: { w?: number; h?: number; ink?: Ink; writing?: boolean } = {}): Shape[] {
  const w = o.w ?? 40;
  const h = o.h ?? 26;
  const ink = paint(o.ink ?? "accent");
  const roof = h * 0.38;
  return [
    {
      tag: "path",
      a: { d: `M${-w / 2 - 2} ${-h / 2}L0 ${-h / 2 - roof}L${w / 2 + 2} ${-h / 2}`, fill: "none", stroke: ink, "stroke-width": 2, "stroke-linejoin": "round" },
    },
    { tag: "rect", a: { x: -w / 2, y: -h / 2, width: w, height: h, rx: Math.min(6, h / 4), fill: paint("raised"), stroke: ink, "stroke-width": 2 } },
    // grey dots in its window while the Dispatcher writes: amber is only for you
    ...(o.writing
      ? [-1, 0, 1].map((i) => ({ tag: "circle" as const, a: { cx: i * h * 0.3, cy: 0, r: h * 0.085, fill: paint("fg2"), "data-dot": i + 1 } }))
      : []),
  ];
}

/** The planner: a pencil whose tip is at (0, 0), for the track it lays ahead. */
export function planner(paint: Paint): Shape[] {
  return [
    {
      tag: "path",
      a: { d: "M0 0L1.5 -4.5L9 -12l3 3L4.5 -1.5Z", fill: paint("raised"), stroke: paint("fg2"), "stroke-width": 1.5, "stroke-linejoin": "round" },
    },
  ];
}

/** Points on a track at (0, 0): the blade lies straight on the main track, or turns off down to a siding. */
export function points(paint: Paint, off = false): Shape[] {
  return [
    {
      tag: "g",
      a: { "data-blade": "", style: `transform-box:fill-box;transform-origin:0 50%;transform:rotate(${off ? 40 : 0}deg)` },
      kids: [{ tag: "path", a: { d: "M0 0H11", stroke: paint(off ? "fg" : "fg3"), "stroke-width": 2.5, "stroke-linecap": "round" } }],
    },
    { tag: "circle", a: { cx: 0, cy: 0, r: 2.5, fill: paint("fg2") } },
  ];
}

/** A siding: a short track that ends at a buffer stop, `len` long to the right of (0, 0). */
export function siding(paint: Paint, len = 56): Shape[] {
  return [
    ...rail(`M0 0H${len}`, paint, { w: 2 }),
    { tag: "path", a: { d: `M${len + 1} -4.5V4.5`, stroke: paint("fg3"), "stroke-width": 3, "stroke-linecap": "round" } },
  ];
}

/** An engine: what pulls the trains, one per account. A steam engine, nose to the right: the cab with its window
 * and roof at the back, the boiler with its chimney and head lamp at the front, three wheels under it. */
export function engine(paint: Paint, o: { w?: number; ink?: Ink; fill?: number } = {}): Shape[] {
  const k = (o.w ?? 30) / 30;
  const ink = paint(o.ink ?? "fg2");
  const line = { fill: paint("raised"), stroke: ink, "stroke-width": 1.75, "stroke-linejoin": "round" };
  return [
    {
      tag: "g",
      a: { transform: `scale(${k})` },
      kids: [
        { tag: "rect", a: { x: -14, y: -11, width: 10, height: 17, rx: 1.5, ...line } },
        { tag: "path", a: { d: "M-15 -11.5H-3", stroke: ink, "stroke-width": 2, "stroke-linecap": "round" } },
        { tag: "rect", a: { x: -11.5, y: -8, width: 5, height: 5, rx: 1, fill: ink } },
        { tag: "rect", a: { x: 5, y: -11, width: 4, height: 6, rx: 1, fill: ink } },
        { tag: "path", a: { d: "M-4 -5H10a4 4 0 0 1 4 4v3a4 4 0 0 1 -4 4H-4Z", ...line } },
        ...(o.fill === undefined
          ? []
          : [
              {
                tag: "rect" as const,
                a: {
                  x: -2.5,
                  y: -3.5,
                  width: 14.5,
                  height: 8,
                  rx: 2.5,
                  fill: ink,
                  "data-fill": o.fill,
                  style: `transform-box:fill-box;transform-origin:left;transform:scaleX(${Math.max(0.06, Math.min(1, o.fill))})`,
                },
              },
            ]),
        { tag: "circle", a: { cx: 11, cy: 0.5, r: 1.6, fill: ink } },
        ...[-9, 0, 8].map((cx) => ({ tag: "circle" as const, a: { cx, cy: 9.5, r: 3, fill: paint("fg3") } })),
      ],
    },
  ];
}

/** Moves shapes by (x, y). */
export const at = (x: number, y: number, kids: Shape[], extra: Record<string, string | number> = {}): Shape => ({
  tag: "g",
  a: { transform: `translate(${x} ${y})`, ...extra },
  kids,
});

/** Shapes as SVG markup, for the README and the brand files. */
export function svgOf(shapes: Shape[]): string {
  return shapes
    .map((s) => {
      const attrs = Object.entries(s.a)
        .map(([k, v]) => ` ${k}="${v}"`)
        .join("");
      return s.kids ? `<${s.tag}${attrs}>${svgOf(s.kids)}</${s.tag}>` : `<${s.tag}${attrs}/>`;
    })
    .join("");
}
