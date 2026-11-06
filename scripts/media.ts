// `bun run media`: every README picture, the film and the social preview, rendered from ui/brand and scripts/film.
//   bun run media                  everything: the motion tokens, then film, stills, roles and social
//   bun run media film|stills|roles|social   one kind (several may be named)
//   bun run media release <version> <view path>...   a release's notes from docs/releases/TEMPLATE.md, with a
//                                                    picture of each view that changed
//   bun run media check            what is stale or off brand (bun run check runs it)
// The film needs Blender (4.2 or later, https://www.blender.org/download/) on PATH or in BLENDER. Each file it makes
// carries the version it was made from, in its own metadata and in docs/readme/media.json.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { slowFailures } from "../src/heavy-run.ts";
import { proposeTiers } from "../src/project.ts";
import sharp, { type OverlayOptions } from "sharp";
import {
  drift,
  filmParts,
  must,
  GROUP_NAMES,
  GROUPS,
  type Group,
  type Manifest,
  MANIFEST,
  railWithMotion,
  readManifest,
  ROOT,
  sha,
  sourcesOf,
} from "./media-lib.ts";

const root = ROOT;
const rel = (f: string) => join(root, f);
const story = () => filmParts(root).story as ReturnType<typeof filmParts>["story"] & { tagline: string };

function version(): string {
  const v = JSON.parse(readFileSync(rel("package.json"), "utf8")).version;
  const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim() || "unknown";
  return `lineclear ${v} (${commit})`;
}

const xmp = (v: string) =>
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
  `<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreatorTool>bun run media, ${v}</xmp:CreatorTool>` +
  `</rdf:Description></rdf:RDF></x:xmpmeta>`;

function run(cmd: string[], env: Record<string, string> = {}) {
  const p = spawnSync(must(cmd[0], "command"), cmd.slice(1), { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (p.error || p.status !== 0) throw new Error(`media: ${cmd.join(" ")} failed${p.error ? `: ${p.error.message}` : ""}`);
}

/** The browser half: ui/test/media.pw.ts, on the pages `lineclear run` serves. */
function browser(what: string, args: unknown) {
  // a port of its own, so it runs beside the UI bar's tests and another checkout's
  const free = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = String(free.port);
  free.stop(true);
  run(["bunx", "playwright", "test", "ui/test/media.pw.ts", "--project", "1440", "--reporter", "line"], {
    MEDIA: what,
    MEDIA_ARGS: JSON.stringify(args),
    LINECLEAR_UI_PORT: process.env.LINECLEAR_UI_PORT || port,
  });
}

function record(manifest: Manifest, g: Group, v: string) {
  manifest[g] = {
    version: v,
    at: new Date().toISOString(),
    files: Object.fromEntries(GROUPS[g].files.map((f) => [f, sha(readFileSync(rel(f)))])),
    from: sourcesOf(root, g),
  };
  writeFileSync(rel(MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
}

// The motion tokens: rail.ts carries motion.json's curves, so the views and the film move alike.
function motion() {
  const next = railWithMotion(root);
  if (next !== readFileSync(rel("ui/brand/rail.ts"), "utf8")) {
    writeFileSync(rel("ui/brand/rail.ts"), next);
    console.log("media: ui/brand/rail.ts takes the motion tokens of scripts/film/motion.json");
  }
}

// The film: Blender renders the scene, the browser sets the captions, sharp lays them over and loops it.

const FADE = 0.3;
const LOOP = 0.5;

async function film(tmp: string, v: string) {
  const blender = process.env.BLENDER || "blender";
  if (spawnSync(blender, ["--version"], { encoding: "utf8" }).status !== 0) {
    throw new Error("media: the film needs Blender 4.2 or later (https://www.blender.org/download/) on PATH or in BLENDER");
  }
  const parts = filmParts(root);
  const s = parts.story;
  const [width, height] = s.size;
  const frames = Math.round(parts.length * s.fps);
  const json = JSON.stringify(parts);
  // The frames stay in a cache named after what they are made from, so a render that stopped goes on where it was.
  const raw = join(homedir(), ".cache", "lineclear", "media", sha(json + readFileSync(rel("scripts/film/line.py"), "utf8")).slice(0, 16));
  mkdirSync(raw, { recursive: true });
  writeFileSync(join(tmp, "parts.json"), json);
  console.log(`media: rendering ${frames} frames of ${width}x${height} in Blender, into ${raw}`);
  run([blender, "-b", "--factory-startup", "-P", rel("scripts/film/line.py"), "--", "--parts", join(tmp, "parts.json"), "--out", raw]);
  browser("captions", { out: tmp, size: [width, height], lines: s.scenes.map((c) => c.caption) });

  const captions = await Promise.all(s.scenes.map((_, i) => readFileSync(join(tmp, `caption-${i}.png`))));
  const first = readFileSync(join(raw, "0000.png"));
  const frame = async (f: number) => {
    const t = f / s.fps;
    const layers: OverlayOptions[] = [];
    const i = s.scenes.findIndex((c) => t >= c.at && t < c.at + c.dur);
    if (i >= 0) {
      const c = must(s.scenes[i], `scene ${i}`);
      const k = Math.min(1, (t - c.at) / FADE, (c.at + c.dur - t) / FADE);
      layers.push({ input: await sharp(captions[i]).ensureAlpha().linear([1, 1, 1, k], [0, 0, 0, 0]).png().toBuffer() });
    }
    // The last half second dissolves into the first frame, so the loop has no seam.
    const into = (t - (parts.length - LOOP)) / LOOP;
    if (into > 0) layers.unshift({ input: await sharp(first).ensureAlpha(Math.min(1, into)).png().toBuffer() });
    return sharp(readFileSync(join(raw, `${String(f).padStart(4, "0")}.png`)))
      .composite(layers)
      .png()
      .toBuffer();
  };
  // Each finished frame goes to a file, so the film is joined from files and not held in memory.
  const out = join(tmp, "film");
  mkdirSync(out);
  const done: string[] = [];
  for (let f = 0; f < frames; f++) {
    const file = join(out, `${String(f).padStart(4, "0")}.png`);
    try {
      writeFileSync(file, await frame(f));
    } catch (e) {
      throw new Error(`media: frame ${f} of the film: ${e instanceof Error ? e.message : e}`);
    }
    done.push(file);
  }
  await sharp(done, { join: { animated: true } })
    .webp({ loop: 0, delay: Array(frames).fill(Math.round(1000 / s.fps)), quality: 72, effort: 5 })
    .withXmp(xmp(v))
    .toFile(rel("docs/readme/film.webp"));
  // The poster, for reduced motion and the social preview: the moment the line waits for you.
  const poster = must(s.scenes[3], "fourth scene");
  await sharp(must(done[Math.round((poster.at + poster.dur / 2) * s.fps)], "poster frame"))
    .withXmp(xmp(v))
    .png()
    .toFile(rel("docs/readme/film.png"));
}

async function stills(tmp: string, v: string) {
  const views = [
    ["/?state=filled", "home"],
    ["/budget-app/roadmap?state=filled", "roadmap"],
    ["/inbox?state=filled", "inbox"],
  ];
  browser("stills", { shots: views.map(([path, name]) => ({ path, file: join(tmp, `${name}.png`) })) });
  for (const [, name] of views)
    await sharp(join(tmp, `${name}.png`))
      .withXmp(xmp(v))
      .png({ compressionLevel: 9 })
      .toFile(rel(`docs/readme/${name}.png`));
}

function roles(v: string) {
  run(["bun", "scripts/readme-roles.ts"]);
  const file = rel("docs/readme/roles.svg");
  const svg = readFileSync(file, "utf8");
  writeFileSync(file, svg.replace(/(<svg[^>]*>)/, `$1<metadata>bun run media, ${v}</metadata>`));
}

async function social(tmp: string, v: string) {
  if (!existsSync(rel("docs/readme/film.png"))) throw new Error("media: the social preview needs the film's poster: run bun run media film");
  browser("social", { poster: rel("docs/readme/film.png"), out: join(tmp, "social.png"), tagline: story().tagline, version: v });
  await sharp(join(tmp, "social.png")).withXmp(xmp(v)).png({ compressionLevel: 9 }).toFile(rel("docs/readme/social.png"));
}

// A release: its notes from the template, with a picture of each view that changed, made the same way as the stills.

export function releaseNotes(template: string, ver: string, pictures: string[]): string {
  const shots = pictures.map((p) => `![${p.replace(/\.png$/, "")}](${ver}/${p})`).join("\n");
  return template.replace(/\{version\}/g, ver).replace("{pictures}", shots);
}

async function release(ver: string, paths: string[], v: string, tmp: string) {
  if (!/^\d+\.\d+\.\d+$/.test(ver) || paths.length === 0) throw new Error("media: bun run media release <version, such as 0.2.0> <view path>...");
  const slow = slowFailures(root, proposeTiers(root, "bun run check").heavy.commands);
  if (slow.length > 0) throw new Error(`media: no release while a slow check fails: ${slow.map((f) => f.name).join(", ")} (bun run heavy)`);
  const dir = rel(`docs/releases/${ver}`);
  mkdirSync(dir, { recursive: true });
  run(["bun", "run", "web:build"]);
  const name = (p: string) => (p.split("?")[0]?.replace(/^\/+|\/+$/g, "") || "home").replace(/\W+/g, "-");
  browser("release", { shots: paths.map((path) => ({ path, file: join(tmp, `${name(path)}.png`) })) });
  for (const p of paths)
    await sharp(join(tmp, `${name(p)}.png`))
      .withXmp(xmp(v))
      .png({ compressionLevel: 9 })
      .toFile(join(dir, `${name(p)}.png`));
  const notes = rel(`docs/releases/${ver}.md`);
  if (!existsSync(notes)) writeFileSync(notes, releaseNotes(readFileSync(rel("docs/releases/TEMPLATE.md"), "utf8"), ver, readdirSync(dir).sort()));
  console.log(`media: docs/releases/${ver}.md and its pictures in docs/releases/${ver}/`);
}

async function main(argv: string[]) {
  if (argv[0] === "check") {
    const problems = drift(root);
    for (const p of problems) console.error(`media: ${p.file} ${p.why}. Fix: ${p.fix}`);
    if (problems.length > 0) process.exit(1);
    console.log("media: every picture bun run media made is made from the brand as it is");
    return;
  }
  const v = version();
  const tmp = mkdtempSync(join(tmpdir(), "lineclear-media-"));
  try {
    if (argv[0] === "release") return await release(argv[1] ?? "", argv.slice(2), v, tmp);
    const groups = argv.length ? argv : GROUP_NAMES;
    const unknown = groups.filter((g) => !(g in GROUPS));
    if (unknown.length) throw new Error(`media: no kind called ${unknown.join(", ")}; the kinds are ${GROUP_NAMES.join(", ")}`);
    motion();
    if (groups.includes("stills")) run(["bun", "run", "web:build"]);
    const manifest = readManifest(root);
    // In this order: the social preview shows the film's poster.
    for (const g of GROUP_NAMES.filter((g) => groups.includes(g))) {
      console.log(`media: ${g}`);
      if (g === "film") await film(tmp, v);
      if (g === "stills") await stills(tmp, v);
      if (g === "roles") roles(v);
      if (g === "social") await social(tmp, v);
      record(manifest, g, v);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
