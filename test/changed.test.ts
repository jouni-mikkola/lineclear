// `check --changed` picks the right tests: on a fixture repo with a chain of imports, a doc a test reads and a test
// that reaches nothing that changed.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { specsFor, testsFor } from "../scripts/changed.ts";
import { buildMap } from "../scripts/load-map.ts";
import { tmp } from "./helpers.ts";

function fixture(): string {
  const root = tmp("changed");
  const files: Record<string, string> = {
    "src/leaf.ts": "export const leaf = 1;\n",
    "src/mid.ts": 'import { leaf } from "./leaf.ts";\nexport const mid = leaf;\n',
    "src/top.ts": 'import { mid } from "./mid";\nexport const top = mid;\n',
    "src/other.ts": "export const other = 2;\n",
    "test/top.test.ts": 'import { top } from "../src/top.ts";\n',
    "test/other.test.ts": 'import { other } from "../src/other.ts";\n',
    "test/doc.test.ts": 'import { readFileSync } from "node:fs";\nreadFileSync("docs/brand.md");\n',
    "test/cli.test.ts": 'Bun.spawn(["bin/lineclear"]);\n',
    "bin/lineclear": 'import { top } from "../src/top.ts";\n',
    "docs/brand.md": "words\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test("a test that imports a changed file, however far, runs; one that does not, stays out", () => {
  const root = fixture();
  expect(testsFor(root, ["src/leaf.ts"])?.sort()).toEqual(["test/cli.test.ts", "test/top.test.ts"]);
  expect(testsFor(root, ["src/other.ts"])).toEqual(["test/other.test.ts"]);
  expect(testsFor(root, ["test/other.test.ts"])).toEqual(["test/other.test.ts"]);
});

test("a test that names a changed doc or the CLI by path runs, and so does one behind the CLI's imports", () => {
  const root = fixture();
  expect(testsFor(root, ["docs/brand.md"])).toEqual(["test/doc.test.ts"]);
  expect(testsFor(root, ["bin/lineclear"])?.sort()).toEqual(["test/cli.test.ts"]);
  expect(testsFor(root, ["src/mid.ts"])?.sort()).toEqual(["test/cli.test.ts", "test/top.test.ts"]);
});

test("a change that can alter every test runs them all; a change that nothing reaches runs none", () => {
  const root = fixture();
  expect(testsFor(root, ["bun.lock"])).toBeUndefined();
  expect(testsFor(root, ["README.md"])).toEqual([]);
});

test("with a load map, a change selects only the tests that load it; what the map does not know falls back", () => {
  const root = fixture();
  const tests = {
    "test/top.test.ts": ["test/top.test.ts", "src/top.ts", "src/mid.ts", "src/leaf.ts"],
    "test/cli.test.ts": ["test/cli.test.ts", "bin/lineclear", "src/top.ts", "src/mid.ts", "src/leaf.ts"],
    "test/other.test.ts": ["test/other.test.ts", "src/other.ts"],
    "test/doc.test.ts": ["test/doc.test.ts"],
  };
  const loads = (drift: string[] = [], map: Record<string, string[]> = tests) => ({ tests: map, drift });
  expect(testsFor(root, ["src/other.ts"], loads())).toEqual(["test/other.test.ts"]);
  // the CLI test is picked by what it loads, not because it names bin/lineclear
  expect(testsFor(root, ["src/leaf.ts"], loads([], { ...tests, "test/cli.test.ts": ["test/cli.test.ts", "bin/lineclear"] }))).toEqual(["test/top.test.ts"]);
  // a file the map does not know goes by the imports; a file changed since the recording counts as changed
  expect(testsFor(root, ["docs/brand.md"], loads())).toEqual(["test/doc.test.ts"]);
  expect(testsFor(root, [], loads(["src/other.ts"]))).toEqual(["test/other.test.ts"]);
  expect(testsFor(root, ["bun.lock"], loads())).toBeUndefined();
  // a test the map does not list runs
  const { "test/other.test.ts": _, ...without } = tests;
  expect(testsFor(root, ["src/leaf.ts"], loads([], without))?.sort()).toEqual(["test/cli.test.ts", "test/other.test.ts", "test/top.test.ts"]);
});

test("the specs run are those of the views changed; shared ui code runs all of them; no ui change runs none", () => {
  expect(specsFor(["src/cli.ts"])).toEqual([]);
  expect(specsFor(["ui/web/chat.tsx"])).toEqual(["ui/test/chat.pw.ts"]);
  expect(specsFor(["ui/web/settings.tsx", "ui/test/roadmap.pw.ts"])).toEqual(["ui/test/settings.pw.ts", "ui/test/roadmap.pw.ts"]);
  expect(specsFor(["ui/kit/line.tsx"])).toBeUndefined();
  expect(specsFor(["ui/test/screens/chat-1440.png"])).toEqual([]);
});

test("the load map follows a test's imports in its own process and adds what a child process it spawned loaded", () => {
  const dir = tmp("load-dumps");
  const dump = (name: string, d: unknown) => writeFileSync(join(dir, name), JSON.stringify(d));
  dump("1.json", {
    edges: [
      ["", "test/a.test.ts"],
      ["test/a.test.ts", "src/a.ts"],
      ["", "test/b.test.ts"],
      ["test/b.test.ts", "src/b.ts"],
      ["src/a.ts", "src/shared.ts"],
    ],
  });
  dump("2.json", {
    owner: "test/b.test.ts",
    edges: [
      ["", "bin/lineclear"],
      ["bin/lineclear", "src/child.ts"],
    ],
  });
  const map = buildMap(dir, ["test/a.test.ts", "test/b.test.ts", "test/never.test.ts"]);
  expect(map["test/a.test.ts"]).toEqual(["src/a.ts", "src/shared.ts", "test/a.test.ts"]);
  expect(map["test/b.test.ts"]).toEqual(["bin/lineclear", "src/b.ts", "src/child.ts", "test/b.test.ts"]);
  expect(map["test/never.test.ts"]).toBeUndefined();
});
