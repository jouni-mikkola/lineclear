// bun run media's drift check, on a copy of what it reads: a picture made from the brand as it is passes, and a
// stale, hand-changed or off-brand one fails with the command that fixes it.
import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drift, GROUP_NAMES, GROUPS, type Manifest, MANIFEST, motionBlock, sha, sourcesOf } from "../scripts/media-lib.ts";
import { releaseNotes } from "../scripts/media.ts";
import { releaseProblems } from "../scripts/release-notes.ts";

const root = join(import.meta.dir, "..");

/** A copy of everything the check reads, with a manifest made for it, as bun run media leaves it. */
function fresh(): string {
  const dir = mkdtempSync(join(tmpdir(), "media-"));
  for (const p of [
    "ui/brand",
    "ui/web",
    "ui/kit",
    "scripts/film",
    "scripts/readme-roles.ts",
    "scripts/svg-motion.ts",
    "scripts/media.ts",
    "scripts/media-lib.ts",
    "ui/test/media.pw.ts",
    "docs/readme",
  ]) {
    cpSync(join(root, p), join(dir, p), { recursive: true, filter: (f) => !f.includes("/dist") && !f.includes("node_modules") });
  }
  const manifest: Manifest = {};
  for (const g of GROUP_NAMES) {
    for (const f of GROUPS[g].files) if (!existsSync(join(dir, f))) writeFileSync(join(dir, f), `a picture: ${f}`);
    manifest[g] = {
      version: "lineclear 0.0.0 (test)",
      at: "2026-11-01T00:00:00.000Z",
      files: Object.fromEntries(GROUPS[g].files.map((f) => [f, sha(readFileSync(join(dir, f)))])),
      from: sourcesOf(dir, g),
    };
  }
  mkdirSync(join(dir, "docs/readme"), { recursive: true });
  writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest));
  return dir;
}

const append = (dir: string, f: string, text: string) => writeFileSync(join(dir, f), readFileSync(join(dir, f), "utf8") + text);

test("pictures made from the brand as it is pass", () => {
  expect(drift(fresh())).toEqual([]);
});

test("a planted stale picture fails: its view changed after it was made", () => {
  const dir = fresh();
  append(dir, "ui/web/app.tsx", "\n// a change to a view\n");
  const problems = drift(dir);
  expect(problems).toHaveLength(1);
  expect(problems[0]?.file).toContain("docs/readme/home.png");
  expect(problems[0]?.why).toBe("is older than the last change to ui/web/app.tsx");
  expect(problems[0]?.fix).toBe("bun run media stills");
});

test("a change to the brand makes every picture made from it stale", () => {
  const dir = fresh();
  append(dir, "ui/brand/tokens.css", "\n/* a change */\n");
  expect(
    drift(dir)
      .map((p) => p.fix)
      .sort(),
  ).toEqual(["bun run media film", "bun run media roles", "bun run media social", "bun run media stills"]);
});

test("a picture changed by hand fails, and so does a missing one", () => {
  const dir = fresh();
  writeFileSync(join(dir, "docs/readme/inbox.png"), "drawn by hand");
  expect(drift(dir)).toEqual([
    { file: "docs/readme/inbox.png", why: "is not the file bun run media made: it was changed by hand or by an older run", fix: "bun run media stills" },
  ]);
});

test("a colour or a font that is not in the tokens fails", () => {
  const dir = fresh();
  append(dir, "scripts/film/line.py", '\n# "#ff00ff"\n');
  append(dir, "ui/test/media.pw.ts", '\n// font-family: "Comic Sans MS"\n');
  const why = drift(dir).map((p) => `${p.file} ${p.why}`);
  expect(why).toContain("scripts/film/line.py uses colours that are not in tokens.css: #ff00ff");
  expect(why).toContain("ui/test/media.pw.ts uses fonts that are not in tokens.css: Comic Sans MS");
});

test("every colour form and every family of a font list is held to the tokens", () => {
  const dir = fresh();
  writeFileSync(
    join(dir, "scripts/film/planted.txt"),
    'fill="#ff00ff80" stroke="#0f08" color: rgb(1, 2, 3)\nfont-family:"Geist","Comic Sans MS",Papyrus;\n<text font-family="Geist, Impact">\n',
  );
  const why = drift(dir).map((p) => `${p.file} ${p.why}`);
  expect(why).toContain("scripts/film/planted.txt uses colours that are not in tokens.css: #ff00ff, #00ff00, rgb(1, 2, 3)");
  expect(why).toContain("scripts/film/planted.txt uses fonts that are not in tokens.css: Comic Sans MS, Papyrus, Impact");
});

test("the motion tokens in rail.ts are the curves of scripts/film/motion.json", () => {
  expect(readFileSync(join(root, "ui/brand/rail.ts"), "utf8")).toContain(motionBlock(root));
  const dir = fresh();
  const file = join(dir, "scripts/film/motion.json");
  writeFileSync(file, readFileSync(file, "utf8").replace('"ms": 200', '"ms": 210'));
  expect(drift(dir).map((p) => `${p.file} ${p.why}`)).toContain("ui/brand/rail.ts its motion tokens differ from scripts/film/motion.json");
});

test("a release's notes follow the template, with its pictures", () => {
  const template = readFileSync(join(root, "docs/releases/TEMPLATE.md"), "utf8");
  const notes = releaseNotes(template, "0.2.0", ["inbox.png", "roadmap.png"]);
  expect(notes).toStartWith("# Lineclear 0.2.0\n\n![inbox](0.2.0/inbox.png)\n![roadmap](0.2.0/roadmap.png)\n");
  expect(notes.match(/^## .+$/gm)).toEqual(["## What changed", "## Fixed", "## Before you update"]);
});

test("release notes that leave the template or miss their picture fail", () => {
  const dir = mkdtempSync(join(tmpdir(), "notes-"));
  mkdirSync(join(dir, "docs/releases/0.2.0"), { recursive: true });
  const rel = join(dir, "docs/releases");
  const template = readFileSync(join(root, "docs/releases/TEMPLATE.md"), "utf8");
  writeFileSync(join(rel, "TEMPLATE.md"), template);
  writeFileSync(join(rel, "0.2.0/inbox.png"), "x");
  writeFileSync(join(rel, "0.2.0.md"), releaseNotes(template, "0.2.0", ["inbox.png"]));
  expect(releaseProblems(dir)).toEqual([]);
  writeFileSync(join(rel, "0.2.0.md"), releaseNotes(template, "0.2.0", ["inbox.png"]).replace("## Fixed", "## Extras"));
  expect(releaseProblems(dir)).toEqual(["0.2.0.md leaves the template's parts or their order"]);
  writeFileSync(join(rel, "0.2.0.md"), releaseNotes(template, "0.2.0", ["gone.png"]));
  expect(releaseProblems(dir)).toEqual(["0.2.0.md shows 0.2.0/gone.png, which is not there"]);
  writeFileSync(join(rel, "0.2.0.md"), "# Lineclear 0.2.0\n\n{pictures}\n");
  expect(releaseProblems(dir)).toEqual([
    "0.2.0.md does not start with the template's title and a picture",
    "0.2.0.md leaves a template field unfilled",
    "0.2.0.md shows no picture of what changed",
  ]);
});

test("a kind not made yet holds nothing, but the README may not show it", () => {
  const dir = fresh();
  const manifest = JSON.parse(readFileSync(join(dir, MANIFEST), "utf8")) as Manifest;
  delete manifest.stills;
  writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest));
  writeFileSync(join(dir, "README.md"), '<img src="docs/readme/roles.svg" alt="">\n');
  expect(drift(dir)).toEqual([]);
  writeFileSync(join(dir, "README.md"), '<img src="docs/readme/home.png" alt="">\n<img src="docs/readme/drawn.png" alt="">\n');
  expect(drift(dir).map((p) => [p.file, p.fix])).toEqual([
    ["docs/readme/home.png", "bun run media stills"],
    ["docs/readme/drawn.png", "add it to GROUPS in scripts/media-lib.ts"],
  ]);
});
