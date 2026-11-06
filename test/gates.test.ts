import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cyclesOf, readModules, scanImports } from "../scripts/gates/borders.ts";
import { findCommentFaults } from "../scripts/gates/comments.ts";
import { judge, lower } from "../scripts/gates/ratchet.ts";
import { MAX_LINES } from "../scripts/gates/size.ts";
import { sh, tmp } from "./helpers.ts";

const REPO = join(import.meta.dir, "..");
const RUN = join(REPO, "scripts", "gates", "run.ts");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A scratch git repo with this repo's Biome config, a small module table and the files given. */
function scratch(files: Record<string, string>): string {
  const dir = tmp("gates");
  dirs.push(dir);
  copyFileSync(join(REPO, "biome.json"), join(dir, "biome.json"));
  const all: Record<string, string> = {
    "package.json": JSON.stringify({ name: "scratch", private: true, type: "module" }),
    "knip.json": JSON.stringify({ entry: ["src/main.ts"], project: ["src/**/*.ts"] }),
    "docs/architecture.md": [
      "| Module | Folder | Owns | May import |",
      "| --- | --- | --- | --- |",
      "| `low` | `src/low/` | the bottom | none |",
      "| `high` | `src/high/`, `src/main.ts` | the top | `low` |",
      "",
    ].join("\n"),
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  sh(["git", "init", "-q"], { cwd: dir });
  sh(["git", "add", "."], { cwd: dir });
  return dir;
}

const gate = (dir: string, ...args: string[]) => sh(["bun", RUN, "--root", dir, ...args]);
const baseline = (dir: string, name: string, counts: Record<string, number>) => {
  mkdirSync(join(dir, "scripts", "gates", "baseline"), { recursive: true });
  writeFileSync(join(dir, "scripts", "gates", "baseline", `${name}.json`), JSON.stringify(counts));
};
// each of these runs a real tool on a scratch repo, slow on a loaded machine
const SLOW = 60_000;
const CLEAN = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";

test("the ratchet fails on more than the baseline and on a baseline that counts more than is found", () => {
  const faults = [
    { key: "a.ts rule", text: "a.ts:1" },
    { key: "a.ts rule", text: "a.ts:2" },
    { key: "b.ts rule", text: "b.ts:1", count: 3 },
  ];
  const v = judge(faults, { "a.ts rule": 1, "b.ts rule": 3, "c.ts rule": 2 });
  expect(v.over.map((o) => [o.key, o.found, o.allowed])).toEqual([["a.ts rule", 2, 1]]);
  expect(v.stale.map((s) => [s.key, s.found, s.allowed])).toEqual([["c.ts rule", 0, 2]]);
});

test("lowering a baseline never raises a count or adds a key", () => {
  const faults = [
    { key: "a", text: "" },
    { key: "a", text: "" },
    { key: "new", text: "" },
  ];
  expect(lower(faults, { a: 1, b: 4 })).toEqual({ a: 1 });
});

test(
  "lint fails on an unused variable and an unused import, and passes clean code",
  () => {
    const dir = scratch({
      "src/main.ts": `import { join } from "node:path";\n${CLEAN}export function f(): string {\n  const unused = 1;\n  return "";\n}\n`,
    });
    const r = gate(dir, "lint");
    expect(r.code).toBe(1);
    expect(r.out).toContain("lint/correctness/noUnusedVariables");
    expect(r.out).toContain("lint/correctness/noUnusedImports");
    expect(gate(scratch({ "src/main.ts": CLEAN }), "lint").code).toBe(0);
  },
  SLOW,
);

test(
  "lint fails on code not in the repo's format",
  () => {
    const r = gate(scratch({ "src/main.ts": "export const a   =  1\n" }), "lint");
    expect(r.code).toBe(1);
    expect(r.out).toContain("src/main.ts format");
  },
  SLOW,
);

test(
  "a fault in the baseline passes, and one more of the same fails",
  () => {
    const dir = scratch({ "src/main.ts": `${CLEAN}export function f(): number {\n  const x = 1;\n  return 2;\n}\n` });
    baseline(dir, "lint", { "src/main.ts lint/correctness/noUnusedVariables": 1 });
    expect(gate(dir, "lint").code).toBe(0);
    writeFileSync(join(dir, "src/main.ts"), `${CLEAN}export function f(): number {\n  const x = 1;\n  const y = 1;\n  return 2;\n}\n`);
    const r = gate(dir, "lint");
    expect(r.code).toBe(1);
    expect(r.out).toContain("2 found, the baseline allows 1");
  },
  SLOW,
);

test(
  "a fixed fault left in the baseline fails until --lower takes it out",
  () => {
    const dir = scratch({ "src/main.ts": CLEAN });
    baseline(dir, "lint", { "src/main.ts lint/correctness/noUnusedVariables": 1 });
    const r = gate(dir, "lint");
    expect(r.code).toBe(1);
    expect(r.out).toContain("fixed but still in the baseline");
    expect(gate(dir, "--lower", "lint").code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "scripts/gates/baseline/lint.json"), "utf8"))).toEqual({});
  },
  SLOW,
);

test(
  "lint looks only at the files changed since main, and at all of them with --full or a changed config",
  () => {
    const UNUSED = "export function f(): number {\n  const x = 1;\n  return 2;\n}\n";
    const dir = scratch({ "src/main.ts": CLEAN, "src/old.ts": UNUSED });
    const git = (...args: string[]) => sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir });
    git("commit", "-qm", "start");
    git("branch", "-M", "main");
    git("checkout", "-qb", "work");
    expect(gate(dir, "lint").code).toBe(0);

    writeFileSync(join(dir, "src/main.ts"), `${CLEAN}${UNUSED.replace("f()", "g()")}`);
    const scoped = gate(dir, "lint");
    expect(scoped.code).toBe(1);
    expect(scoped.out).toContain("src/main.ts lint/correctness/noUnusedVariables");
    expect(scoped.out).not.toContain("src/old.ts");
    expect(gate(dir, "--full", "lint").out).toContain("src/old.ts lint/correctness/noUnusedVariables");

    writeFileSync(join(dir, "src/main.ts"), CLEAN);
    writeFileSync(join(dir, "biome.json"), `${readFileSync(join(dir, "biome.json"), "utf8")}\n`);
    const config = gate(dir, "lint");
    expect(config.code).toBe(1);
    expect(config.out).toContain("src/old.ts lint/correctness/noUnusedVariables");

    git("checkout", "-q", "biome.json");
    writeFileSync(join(dir, "notes.md"), "only words\n");
    expect(gate(dir, "lint").code).toBe(0);

    baseline(dir, "lint", { "src/old.ts lint/correctness/noUnusedVariables": 1 });
    rmSync(join(dir, "src/old.ts"));
    const deleted = gate(dir, "lint");
    expect(deleted.code).toBe(1);
    expect(deleted.out).toContain("fixed but still in the baseline");
  },
  SLOW,
);

test(
  "a run over its time limit fails, unless a cold cache made it slow",
  () => {
    const dir = scratch({ "src/main.ts": CLEAN });
    const slow = gate(dir, "--limit", "0", "size");
    expect(slow.code).toBe(1);
    expect(slow.out).toContain("over the limit of 0 s");
    // the scratch repo has no knip cache yet
    const cold = gate(dir, "--limit", "0", "dead-code");
    expect(cold.code).toBe(0);
    expect(cold.out).toContain("not counted: dead-code");
  },
  SLOW,
);

test(
  "dead code fails on an unused export and an unused file",
  () => {
    const dir = scratch({
      "src/main.ts": 'import { used } from "./high/lib.ts";\nconsole.log(used);\n',
      "src/high/lib.ts": "export const used = 1;\nexport const unused = 2;\n",
      "src/high/orphan.ts": "export const alone = 3;\n",
    });
    const r = gate(dir, "dead-code");
    expect(r.code).toBe(1);
    expect(r.out).toContain("src/high/lib.ts:2 unused exports: unused");
    expect(r.out).toContain("unused files: src/high/orphan.ts");
  },
  SLOW,
);

test(
  "borders fail on an import the module table does not allow and on a file in no module",
  () => {
    const dir = scratch({
      "src/low/base.ts": 'import { top } from "../high/top.ts";\nexport const base = top;\n',
      "src/high/top.ts": "export const top = 1;\n",
      "src/high/ok.ts": 'import { base } from "../low/base.ts";\nexport const ok = base;\n',
      "src/stray.ts": "export const stray = 1;\n",
    });
    const r = gate(dir, "borders");
    expect(r.code).toBe(1);
    expect(r.out).toContain("src/low/base.ts:1 imports src/high/top.ts: low may not import high");
    expect(r.out).toContain("src/stray.ts is in no module");
    expect(r.out).not.toContain("src/high/ok.ts");
  },
  SLOW,
);

test(
  "size fails on a file over the limit, passes it at its baseline and fails it when it grows",
  () => {
    const long = (n: number) => `${Array.from({ length: n - 1 }, (_, i) => `export const v${i} = ${i};`).join("\n")}\n`;
    const dir = scratch({ "src/high/long.ts": long(MAX_LINES + 1) });
    expect(gate(dir, "size").out).toContain(`src/high/long.ts: ${MAX_LINES + 1} lines, over ${MAX_LINES}`);
    baseline(dir, "size", { "src/high/long.ts": MAX_LINES + 1 });
    expect(gate(dir, "size").code).toBe(0);
    writeFileSync(join(dir, "src/high/long.ts"), long(MAX_LINES + 2));
    expect(gate(dir, "size").code).toBe(1);
  },
  SLOW,
);

test(
  "comments fail on commented-out code and a TODO with no task id",
  () => {
    const dir = scratch({
      "src/high/c.ts":
        "// const old = load();\nexport const a = 1;\n// TODO make it faster\n// TODO(LIN-12) a task owns this one\n// waits for the tick, see tick()\n",
    });
    const r = gate(dir, "comments");
    expect(r.code).toBe(1);
    expect(r.out).toContain("src/high/c.ts:1 commented-out code: const old = load();");
    expect(r.out).toContain("src/high/c.ts:3 a TODO with no task id");
    expect(r.out).not.toContain(":4 ");
    expect(r.out).not.toContain(":5 ");
  },
  SLOW,
);

test("prose and examples in comments are not code", () => {
  const src =
    '// return early when nothing changed\n// (see below)\n//\n//   <reaction from="a"/>\n//   run(x);\n// https://example.com/a?b=c\nexport const a = 1;\nconst url = "http://x.dev/TODO"; // it\'s a link\n';
  expect(findCommentFaults("a.ts", src)).toEqual([]);
});

test("the module table reads names, folders and imports, and imports are read with their kind", () => {
  expect(readModules("| `a` | `x/`, `y.ts` | owns | `b`, `c` |\n| `b` | `z/` | owns | none |")).toEqual([
    { name: "a", folders: ["x/", "y.ts"], imports: ["b", "c"] },
    { name: "b", folders: ["z/"], imports: [] },
  ]);
  const imports = scanImports(
    'import a from "./a.ts";\nimport type { B } from "./b.ts";\nimport {\n  type C,\n  type D,\n} from "./c.ts";\nexport * from "./e.ts";\nconst f = await import("./f.ts");\n',
  );
  expect(imports.map((i) => [i.spec, i.line, i.typeOnly])).toEqual([
    ["./a.ts", 1, false],
    ["./b.ts", 2, true],
    ["./c.ts", 3, true],
    ["./e.ts", 7, false],
    ["./f.ts", 8, false],
  ]);
  expect(
    cyclesOf(
      new Map([
        ["a", ["b"]],
        ["b", ["a", "c"]],
        ["c", []],
      ]),
    ),
  ).toEqual([["a", "b"]]);
});

test(
  "code-rules fail on a model name in code, with its file and line, and leave test fixtures alone",
  () => {
    const dir = scratch({
      "src/high/m.ts": 'export const a = 1;\nexport const model = "claude-sonnet-5-5";\n',
      "ui/web/s.ts": "// shown as Opus 5.5\nexport const b = 2;\n",
      "src/high/o.ts": 'export const e = ["GPT 4.1", "Gemini 2.5 Pro", "kimi-k2", "glm-4", "o3-mini"];\n',
      "src/high/clean.ts": 'export const c = "vendor/model-top";\n',
      "ui/test/fixture.ts": 'export const d = "gpt-6-sol";\n',
      "docs/idea.md": "gpt-6-sol\n",
    });
    const r = gate(dir, "code-rules");
    expect(r.code).toBe(1);
    expect(r.out).toContain("src/high/m.ts:2 a model name in code (claude-sonnet)");
    expect(r.out).toContain("ui/web/s.ts:1 a model name in code (Opus 5)");
    expect(r.out).toContain("src/high/o.ts:1 a model name in code (GPT 4)");
    expect(r.out).not.toContain("clean.ts");
    expect(r.out).not.toContain("fixture.ts");
    expect(r.out).not.toContain("idea.md");
  },
  SLOW,
);

test(
  "old-name fails on the old product's name in a code file, a doc, a skill and a path, and leaves the notice and the changelog alone",
  () => {
    const old = ["shep", "herdr"].join("");
    const dir = scratch({
      "src/high/c.ts": `export const a = "${old}";\n`,
      "docs/idea.md": `Use ${old[0]?.toUpperCase()}${old.slice(1)} here.\n`,
      "server/skill/lineclear/SKILL.md": `run ${old} first\n`,
      [`docs/${old}-notes.md`]: "clean text\n",
      "server/NOTICE": `${old} 2.0.0\n`,
      "CHANGELOG.md": `- ${old} is gone\n`,
      "src/high/clean.ts": "export const b = 1;\n",
    });
    const r = gate(dir, "old-name");
    expect(r.code).toBe(1);
    expect(r.out).toContain("src/high/c.ts:1 the old name");
    expect(r.out).toContain("docs/idea.md:1 the old name");
    expect(r.out).toContain("server/skill/lineclear/SKILL.md:1 the old name");
    expect(r.out).toContain("notes.md: the old name in the file's path");
    expect(r.out).not.toContain("NOTICE");
    expect(r.out).not.toContain("CHANGELOG");
    expect(r.out).not.toContain("clean.ts");
  },
  SLOW,
);

test(
  "code-rules also fail on a herdr command or socket outside the adapter, and leave the adapter and comments alone",
  () => {
    const dir = scratch({
      "src/herdr.ts": 'export const a = ["herdr", "status"];\n',
      "server/server/live/herdr.ts": 'export const s = ".config/herdr/herdr.sock";\n',
      "src/other.ts": '// ["herdr", "x"]\nexport const b = Bun.spawnSync(["herdr", "workspace", "list"]);\n',
      "server/server/live/bridge.ts": "export const c = process.env.HERDR_SOCKET_PATH;\n",
      "src/clean.ts": 'export const d = which("herdr");\n',
      "server/server/live/direct.ts": 'export const e = Bun.spawnSync("herdr", ["status"]);\n',
    });
    const r = gate(dir, "code-rules");
    expect(r.code).toBe(1);
    expect(r.out).toContain("src/other.ts:2 a herdr call outside the adapter");
    expect(r.out).toContain("server/server/live/bridge.ts:1 a herdr call outside the adapter");
    expect(r.out).toContain("server/server/live/direct.ts:1 a herdr call outside the adapter");
    expect(r.out).not.toContain("src/herdr.ts:");
    expect(r.out).not.toContain("clean.ts");
    expect(r.out).not.toContain("other.ts:1");
  },
  SLOW,
);

const BLOCK = Array.from({ length: 12 }, (_, i) => `  total += values[${i}] * weights[${i}] - offsets[${i}];`).join("\n");
const copyBody = (name: string) =>
  `export function ${name}(values: number[], weights: number[], offsets: number[]): number {\n  let total = 0;\n${BLOCK}\n  return total;\n}\n`;
const LONG = `${Array.from({ length: 700 }, (_, i) => `export const v${i} = ${i};`).join("\n")}\n`;

/** L318: one fault of each class (a cycle of type-only imports is none), in a repo of one module table; the merged gates keep their classes. */
const PLANTED: Record<string, string> = {
  "src/main.ts": 'import { top } from "./high/top.ts";\nimport { x } from "./high/x.ts";\nexport const main = [top, x];\n',
  "src/low/base.ts":
    'import { top } from "../high/top.ts";\nexport const base = top;\nexport const unused = 1;\nexport function f(): number {\n  const x = 1;\n  return 2;\n}\n// const old = load();\nexport const bad  =  1\n',
  "src/high/top.ts": 'export const top = "claude-sonnet-5-5";\nexport const sock = ["herdr", "status"];\n',
  "src/high/x.ts": 'import { y } from "./y.ts";\nexport const x = () => y;\n',
  "src/high/t1.ts": 'import type { T2 } from "./t2.ts";\nexport type T1 = { t: T2 };\n',
  "src/high/t2.ts": 'import { type T1 } from "./t1.ts";\nexport type T2 = { t?: T1 };\n',
  "src/high/y.ts": 'import { x } from "./x.ts";\nexport const y = () => x;\n',
  "src/high/a.ts": copyBody("first"),
  "src/high/b.ts": copyBody("second"),
  "src/high/long.ts": LONG,
};

test(
  "the gates step refuses one planted fault of each class and names every gate that caught one",
  () => {
    const dir = scratch(PLANTED);
    const r = gate(dir, "--full");
    expect(r.code).toBe(1);
    const last = r.out.trim().split("\n").at(-1) ?? "";
    expect(last).toStartWith("gates failed: ");
    expect(last.slice("gates failed: ".length).split(", ").sort()).toEqual(["borders", "code-rules", "comments", "copies", "dead-code", "lint", "size"]);
    expect(r.out).toContain("src/high/a.ts = src/high/b.ts");
    expect(r.out).toContain("src/high/x.ts > src/high/y.ts");
    expect(r.out).not.toContain("cycle src/high/t1.ts");
  },
  SLOW,
);
