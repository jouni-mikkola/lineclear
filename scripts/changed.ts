// What a change reaches, for `bun run check --changed` and the UI specs of a worker: the root tests that import a
// changed file (the import graph), the browser specs of the views a change touches, and which packages need types.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const CODE = /\.(ts|tsx)$/;
const SKIP = new Set(["node_modules", ".git", "server", "docs", "templates"]);
// a change to any of these can alter every test (package.json is left out: a new dependency moves bun.lock too)
const EVERYTHING = ["bun.lock", "bunfig.toml", "tsconfig.json", "test/tmp-scope.ts"];
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

const walk = (root: string, dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : walk(root, path);
    return CODE.test(e.name) || path === "bin/lineclear" ? [path] : [];
  });

/** The repo file a relative import names, or undefined for a package or a file that is not there. */
function resolveImport(root: string, from: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const base = normalize(join(dirname(from), spec));
  const stem = base.replace(/\.(js|jsx)$/, "");
  for (const c of [base, `${stem}.ts`, `${stem}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (statSync(join(root, c), { throwIfNoEntry: false })?.isFile()) return c;
  }
  return undefined;
}

/** For each file, the files that import it directly. */
function importers(root: string, files: string[], text: Map<string, string>): Map<string, Set<string>> {
  const into = new Map<string, Set<string>>();
  for (const file of files) {
    for (const m of (text.get(file) ?? "").matchAll(IMPORT)) {
      const target = resolveImport(root, file, m[1] ?? "");
      if (target) into.set(target, (into.get(target) ?? new Set()).add(file));
    }
  }
  return into;
}

/** What a recorded run saw (scripts/load-map.ts): the files each test loads, and the files changed since the recording. */
export interface Loads {
  tests: Record<string, string[]>;
  drift: string[];
}

/**
 * The root test files (test/*.test.ts, .tsx) that reach a changed file. With a load map, a code file the map knows
 * reaches the tests that load it; a file it does not know (new, never loaded, a doc) and a test the map does not list
 * go by the rule below. Without a map: by imports, however far. A test also reaches a file it names by path (a doc, a
 * template, `bin/lineclear`), which no import shows. Undefined means all of them.
 */
export function testsFor(root: string, changed: string[], loads?: Loads): string[] | undefined {
  if (!loads) return testsByImports(root, changed);
  const all = [...new Set([...changed, ...loads.drift])];
  if (all.some((f) => EVERYTHING.includes(f))) return undefined;
  const mapped = Object.entries(loads.tests);
  const known = new Set(mapped.flatMap(([, files]) => files));
  const unknown = all.filter((f) => !known.has(f));
  const picked = new Set(mapped.filter(([, files]) => all.some((f) => files.includes(f))).map(([test]) => test));
  const rest = unknown.length > 0 ? testsByImports(root, unknown) : [];
  if (rest === undefined) return undefined;
  for (const t of rest) picked.add(t);
  // a test the map does not list is new or never loaded: it runs
  const listed = new Set(Object.keys(loads.tests));
  for (const t of testFiles(root)) if (!listed.has(t)) picked.add(t);
  return [...picked].sort();
}

const testFiles = (root: string) => walk(root, "test").filter((f) => /^test\/.*\.test\.tsx?$/.test(f));

function testsByImports(root: string, changed: string[]): string[] | undefined {
  if (changed.some((f) => EVERYTHING.includes(f))) return undefined;
  const files = ["src", "test", "scripts", "ui", "pi", "bin"].filter((d) => existsSync(join(root, d))).flatMap((d) => walk(root, d));
  const text = new Map(files.map((f) => [f, readFileSync(join(root, f), "utf8")]));
  const tests = files.filter((f) => /^test\/.*\.test\.tsx?$/.test(f));
  const by = importers(root, files, text);
  const reached = new Set(changed);
  const queue = [...changed];
  for (let f = queue.pop(); f !== undefined; f = queue.pop()) {
    for (const up of by.get(f) ?? []) {
      if (reached.has(up)) continue;
      reached.add(up);
      queue.push(up);
    }
  }
  // a script or the CLI is run by its path, a doc is read by it: no import shows either
  const named = [...reached].filter((f) => !CODE.test(f) || f === "bin/lineclear" || f.startsWith("scripts/"));
  return tests.filter((t) => reached.has(t) || named.some((f) => text.get(t)?.includes(f)));
}

// The spec files a view's code is tested by. Code not listed here (the kit, the brand, the frame, the routes, the
// build, the helpers every spec shares) can change any view, so it runs them all.
const VIEW_SPECS: [RegExp, string[]][] = [
  [/^ui\/(web\/(home|inbox|alerts|usage)|test\/samples\/(page|real-samples))\b/, ["views", "usage-inbox", "add-project"]],
  [/^ui\/(web\/chat|test\/samples\/chat-samples)\b/, ["chat"]],
  [/^ui\/(web\/browsers|test\/samples\/browser-samples)\b/, ["browsers"]],
  [/^ui\/(web\/settings|test\/samples\/settings-samples)\b/, ["settings"]],
  [/^ui\/(web\/roadmap|test\/samples\/roadmap-samples)/, ["roadmap"]],
  [/^ui\/web\/design\b/, ["design", "kit"]],
];

/** The spec files (ui/test/*.pw.ts) to run for these changed files; undefined for all of them, empty when ui/ did not change. */
export function specsFor(changed: string[]): string[] | undefined {
  const ui = changed.filter((f) => f.startsWith("ui/") || f === "playwright.config.ts");
  const specs = new Set<string>();
  for (const f of ui) {
    const own = /^ui\/test\/([\w-]+)\.pw\.ts$/.exec(f);
    if (own) {
      specs.add(own[1] ?? "");
      continue;
    }
    // screenshots and notes in ui/test/screens and the like belong to no code
    if (/^ui\/test\/screens\//.test(f) || /\.(md|json|svg|jpg)$/.test(f)) continue;
    const view = VIEW_SPECS.find(([re]) => re.test(f));
    if (!view) return undefined;
    for (const s of view[1]) specs.add(s);
  }
  return [...specs].map((s) => `ui/test/${s}.pw.ts`);
}
