// What `bun run media` makes and what `bun run check` holds it to: every README picture and the film are made from
// ui/brand (tokens, fonts, role marks, the rail parts) and scripts/film (the motion curves and the story), and
// docs/readme/media.json records, for each file, the version and commit it was made from, its own hash and the hash
// of every file it was made from. A picture whose sources changed since, or that someone changed by hand, is stale.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { hex, INK, rail, signal, signalBox, station, train } from "../ui/brand/rail.ts";

export const ROOT = join(import.meta.dir, "..");
export const MANIFEST = "docs/readme/media.json";

// The scripts that lay out, compose and label every picture but the roles chart (which test/readme-film.test.ts holds).
const MAKERS = ["scripts/media.ts", "scripts/media-lib.ts"];

/** Each kind of picture: the files it makes and the files and folders it is made from. */
export const GROUPS = {
  film: {
    files: ["docs/readme/film.webp", "docs/readme/film.png"],
    from: ["scripts/film", "ui/brand/tokens.css", "ui/brand/fonts", "ui/brand/rail.ts", "ui/test/media.pw.ts", ...MAKERS],
    make: "bun run media film",
  },
  stills: {
    files: ["docs/readme/home.png", "docs/readme/roadmap.png", "docs/readme/inbox.png"],
    from: ["ui/web", "ui/kit", "ui/brand", "ui/test/media.pw.ts", ...MAKERS],
    make: "bun run media stills",
  },
  roles: {
    files: ["docs/readme/roles.svg"],
    from: ["scripts/readme-roles.ts", "scripts/svg-motion.ts", "ui/brand"],
    make: "bun run media roles",
  },
  social: {
    files: ["docs/readme/social.png"],
    from: ["ui/brand", "scripts/film/story.json", "docs/readme/film.png", "ui/test/media.pw.ts", ...MAKERS],
    make: "bun run media social",
  },
} as const;
export type Group = keyof typeof GROUPS;
/** The older SVG film (scripts/readme-film.ts) and the hand-drawn header, kept until the film of U68 takes their place. */
const BEFORE_THE_FILM = ["docs/readme/line.svg", "docs/readme/header.svg"];
export const GROUP_NAMES = Object.keys(GROUPS) as Group[];

interface Made {
  version: string;
  at: string;
  /** sha256 of each file it made. */
  files: Record<string, string>;
  /** sha256 of each file it was made from. */
  from: Record<string, string>;
}
export type Manifest = Partial<Record<Group, Made>>;

/** The value, or an error that names what was missing. */
export function must<T>(x: T | undefined, what: string): T {
  if (x === undefined) throw new Error(`media: no ${what}`);
  return x;
}

export const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** Every file under the paths, relative to `root`, in order. Build output and symlinks are left out. */
function filesUnder(root: string, paths: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) return;
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) if (!["dist", "node_modules", ".DS_Store", "__pycache__"].includes(name)) walk(join(rel, name));
    } else out.push(relative(root, abs));
  };
  for (const p of paths) walk(p);
  return [...new Set(out)].sort();
}

export function sourcesOf(root: string, group: Group): Record<string, string> {
  return Object.fromEntries(filesUnder(root, GROUPS[group].from).map((f) => [f, sha(readFileSync(join(root, f)))]));
}

export function readManifest(root: string = ROOT): Manifest {
  const file = join(root, MANIFEST);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

// Tokens: the colours and fonts of tokens.css, the only ones a picture may use.

function tokens(root: string = ROOT): { colours: Record<string, string>; fonts: string[]; fontStacks: Record<string, string> } {
  const css = readFileSync(join(root, "ui/brand/tokens.css"), "utf8");
  const colours = Object.fromEntries([...css.matchAll(/--lc-([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map(([, k = "", c = ""]) => [k, c.toLowerCase()]));
  const fontStacks = Object.fromEntries([...css.matchAll(/--lc-(font[\w-]*):\s*([^;]+);/g)].map(([, k = "", v = ""]) => [k, v.trim()]));
  const fonts = [...new Set(Object.values(fontStacks).flatMap((s) => s.split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""))))];
  return { colours, fonts, fontStacks };
}

/** Colours (hex of 3, 4, 6 or 8 digits, rgb() and hsl()) and font families a file uses that the tokens lack. */
function offTokens(text: string, root: string = ROOT): { colours: string[]; fonts: string[] } {
  const t = tokens(root);
  const allowed = new Set(Object.values(t.colours));
  // #rgb and #rgba to #rrggbb; the alpha of #rgba and #rrggbbaa is left out, the colour must still be a token
  const full = (c: string) => (c.length <= 5 ? `#${[...c.slice(1, 4)].map((d) => d + d).join("")}` : c.slice(0, 7)).toLowerCase();
  const hexes = [...text.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g)].map((m) => full(m[0]));
  const functions = [...text.matchAll(/\b(?:rgba?|hsla?)\([^)]*\)/g)].map((m) => m[0]);
  const colours = [...new Set([...hexes.filter((c) => !allowed.has(c)), ...functions])];
  // the whole value: an attribute in quotes, or a CSS declaration up to its end, every family in it
  const values = [...text.matchAll(/font-family\s*(?:=\s*"([^"]*)"|=\s*'([^']*)'|:\s*([^;}<>\n]+))/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
  const families = values.flatMap((v) =>
    v
      .replace(/&quot;/g, '"')
      .split(",")
      .map((f) => f.trim().replace(/^["']|["']$/g, "")),
  );
  const fonts = [...new Set(families)].filter((f) => f !== "" && !t.fonts.includes(f) && !f.startsWith("var(--lc-font") && !f.includes("${"));
  return { colours, fonts };
}

// Motion: scripts/film/motion.json is the one source; rail.ts carries it between two marker lines.

const MOTION_START = "// Motion tokens: written by `bun run media` from scripts/film/motion.json, the one source the film reads too.";
const MOTION_END = "// End of the motion tokens.";

export function motionBlock(root: string = ROOT): string {
  const m = JSON.parse(readFileSync(join(root, "scripts/film/motion.json"), "utf8")) as {
    ease: Record<string, { curve: number[]; what: string }>;
    ms: Record<string, { ms: number; what: string }>;
    key: Record<string, { ms: string; ease: string; what: string; frames?: Record<string, string | number>[] }>;
  };
  const num = (n: number) => String(n).replace(/^0\./, ".");
  const curve = (name: string) => `cubic-bezier(${must(m.ease[name], `ease ${name} in motion.json`).curve.map(num).join(",")})`;
  const frame = (f: Record<string, string | number>) =>
    `{ ${Object.entries(f)
      .map(([k, v]) => `${k}: ${k === "easing" ? `EASE.${v}` : JSON.stringify(v)}`)
      .join(", ")} }`;
  return [
    MOTION_START,
    "// Nothing moves linearly but the loading loop and a lamp's colour, which change at an even pace.",
    "export const EASE = {",
    ...Object.entries(m.ease).flatMap(([k, v]) => [`  /** ${v.what} */`, `  ${k}: "${curve(k)}",`]),
    "} as const;",
    "export const MS = {",
    ...Object.entries(m.ms).flatMap(([k, v]) => [`  /** ${v.what} */`, `  ${k}: ${v.ms},`]),
    "} as const;",
    "/** The key motions the app and the board share: their time, their curve and, where fixed, their keyframes. */",
    "export const KEY = {",
    ...Object.entries(m.key).flatMap(([k, v]) => [
      `  /** ${v.what} */`,
      `  ${k}: { ms: ${must(m.ms[v.ms], `time ${v.ms} in motion.json`).ms}, ease: EASE.${must(m.ease[v.ease], `ease ${v.ease} in motion.json`) && v.ease}${v.frames ? `, frames: [${v.frames.map(frame).join(", ")}]` : ""} },`,
    ]),
    "} as const;",
    MOTION_END,
  ].join("\n");
}

/** rail.ts with its motion block written from motion.json. */
export function railWithMotion(root: string = ROOT): string {
  const src = readFileSync(join(root, "ui/brand/rail.ts"), "utf8");
  const a = src.indexOf(MOTION_START);
  const b = src.indexOf(MOTION_END);
  if (a < 0 || b < a) throw new Error("ui/brand/rail.ts lost its motion markers");
  return src.slice(0, a) + motionBlock(root) + src.slice(b + MOTION_END.length);
}

// The film's parts: sizes from the rail parts the views draw, colours from the tokens, curves from motion.json.

const attr = (shapes: ReturnType<typeof train>, i: number, k: string) => Number(shapes[i]?.a[k]);

export function filmParts(root: string = ROOT) {
  const story = JSON.parse(readFileSync(join(root, "scripts/film/story.json"), "utf8")) as {
    fps: number;
    size: [number, number];
    scenes: { at: number; dur: number; caption: string }[];
  };
  const motion = JSON.parse(readFileSync(join(root, "scripts/film/motion.json"), "utf8")) as {
    ease: Record<string, { curve: number[] }>;
    ms: Record<string, { ms: number }>;
  };
  const t = tokens(root);
  const last = must(story.scenes.at(-1), "scene in story.json");
  const r = rail("M0 0H10", hex);
  const [tie, gap] = String(r[0]?.a["stroke-dasharray"]).split(" ").map(Number);
  const tr = train("work", hex);
  const sg = signal("clear", hex);
  const bx = signalBox(hex);
  const st = station("ahead", hex);
  return {
    ink: Object.fromEntries(Object.keys(INK).map((k) => [k, must(t.colours[k], `token --lc-${k}`)])),
    ease: Object.fromEntries(Object.entries(motion.ease).map(([k, v]) => [k, v.curve])),
    ms: Object.fromEntries(Object.entries(motion.ms).map(([k, v]) => [k, v.ms])),
    story,
    length: last.at + last.dur,
    parts: {
      rail: { w: Number(r[1]?.a["stroke-width"]), tie: must(tie, "tie"), gap: must(tie, "tie") + must(gap, "gap") },
      station: { r: attr(st, 0, "r"), ring: attr(st, 0, "stroke-width") },
      train: { w: attr(tr, 0, "width"), h: attr(tr, 0, "height"), lamp: attr(tr, 1, "r") },
      signal: {
        mast: Math.abs(Number(String(sg[0]?.a.d).match(/V(-?[\d.]+)/)?.[1]) - Number(String(sg[0]?.a.d).match(/^M0 (-?[\d.]+)/)?.[1])),
        w: attr(sg, 1, "width"),
        h: attr(sg, 1, "height"),
        lamp: attr(sg, 2, "r"),
      },
      box: { w: attr(bx, 1, "width"), h: attr(bx, 1, "height") },
    },
  };
}

// The drift check.

interface Problem {
  file: string;
  why: string;
  fix: string;
}

/** Every picture the README shows is one bun run media made, or the SVG film it replaces (U68). */
function unmade(root: string, manifest: Manifest): Problem[] {
  const out: Problem[] = [];
  const readme = existsSync(join(root, "README.md")) ? readFileSync(join(root, "README.md"), "utf8") : "";
  const shown = readme.matchAll(/(?:src|srcset)=["'](?:\.\/)?(docs\/readme\/[^"']+)["']|\]\((?:\.\/)?(docs\/readme\/[^)\s]+)\)/g);
  for (const m of shown) {
    const f = m[1] ?? m[2] ?? "";
    const g = GROUP_NAMES.find((n) => (GROUPS[n].files as readonly string[]).includes(f));
    if (g && !manifest[g]) out.push({ file: f, why: "is in the README but was never made by bun run media", fix: GROUPS[g].make });
    else if (!g && !BEFORE_THE_FILM.includes(f))
      out.push({ file: f, why: "is in the README but bun run media does not make it", fix: "add it to GROUPS in scripts/media-lib.ts" });
  }
  return out;
}

/** Each kind made: a file changed by hand or missing, or made before a change to what it is made from. */
function stale(root: string, manifest: Manifest): Problem[] {
  const out: Problem[] = [];
  for (const g of GROUP_NAMES) {
    const made = manifest[g];
    const spec = GROUPS[g];
    // A kind not made yet holds nothing: the README shows only what was made (below).
    if (!made) continue;
    for (const f of spec.files) {
      const abs = join(root, f);
      if (!existsSync(abs)) out.push({ file: f, why: "is missing", fix: spec.make });
      else if (sha(readFileSync(abs)) !== made.files[f])
        out.push({ file: f, why: "is not the file bun run media made: it was changed by hand or by an older run", fix: spec.make });
    }
    const now = sourcesOf(root, g);
    const changed = [...new Set([...Object.keys(now), ...Object.keys(made.from)])].filter((f) => now[f] !== made.from[f]).sort();
    if (changed.length > 0) {
      const names = changed.slice(0, 4).join(", ") + (changed.length > 4 ? ` and ${changed.length - 4} more` : "");
      out.push({ file: spec.files.join(", "), why: `is older than the last change to ${names}`, fix: spec.make });
    }
  }
  return out;
}

/** Colours and fonts outside the tokens. */
function offBrand(root: string): Problem[] {
  const out: Problem[] = [];
  // Colours and fonts: in the pictures written as text, and in what the film and the social preview are made from.
  const scan = [
    ...filesUnder(root, ["docs/readme"]).filter((f) => f.endsWith(".svg") && !BEFORE_THE_FILM.includes(f)),
    ...filesUnder(root, ["scripts/film"]),
    "ui/test/media.pw.ts",
    "scripts/media.ts",
    "scripts/readme-film.ts",
    "scripts/readme-roles.ts",
    "scripts/svg-motion.ts",
  ];
  for (const f of scan) {
    const abs = join(root, f);
    if (!existsSync(abs)) continue;
    const off = offTokens(readFileSync(abs, "utf8"), root);
    if (off.colours.length)
      out.push({ file: f, why: `uses colours that are not in tokens.css: ${off.colours.join(", ")}`, fix: "use the tokens of ui/brand/tokens.css" });
    if (off.fonts.length) out.push({ file: f, why: `uses fonts that are not in tokens.css: ${off.fonts.join(", ")}`, fix: "use the tokens' font" });
  }
  return out;
}

/** Everything that makes a README picture or the film stale or off brand, each with the command that fixes it. */
export function drift(root: string = ROOT): Problem[] {
  const out: Problem[] = [];
  const manifest = readManifest(root);
  const rail = readFileSync(join(root, "ui/brand/rail.ts"), "utf8");
  if (!rail.includes(motionBlock(root)))
    out.push({ file: "ui/brand/rail.ts", why: "its motion tokens differ from scripts/film/motion.json", fix: "bun run media roles" });
  const t = tokens(root);
  for (const [k, v] of Object.entries(INK)) {
    if (t.colours[k] !== v)
      out.push({ file: "ui/brand/rail.ts", why: `INK.${k} is ${v}, but tokens.css says ${t.colours[k] ?? "nothing"}`, fix: "make it the token's value" });
  }
  out.push(...stale(root, manifest));
  out.push(...unmade(root, manifest));
  out.push(...offBrand(root));
  return out;
}
