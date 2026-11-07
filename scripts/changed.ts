// What a change reaches, for `bun run check --changed`: the root tests that import a changed file and the browser specs of the views
// it touches. `bun run ui:changed` (`bun scripts/changed.ts ui`) builds and runs those specs; the full suite is `bun run ui:test`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { changedSince } from "./gates/tools.ts";

const CODE = /\.(ts|tsx)$/;
const TEST = /^test\/.*\.test\.tsx?$/;
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
  const tries = [base, `${stem}.ts`, `${stem}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  return tries.find((c) => statSync(join(root, c), { throwIfNoEntry: false })?.isFile());
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
  const picked = new Set(mapped.filter(([, files]) => all.some((f) => files.includes(f))).map(([test]) => test));
  const rest = testsByImports(
    root,
    all.filter((f) => !known.has(f)),
  );
  if (rest === undefined) return undefined;
  for (const t of [...rest, ...walk(root, "test").filter((f) => TEST.test(f) && !(f in loads.tests))]) picked.add(t);
  return [...picked].sort();
}

function testsByImports(root: string, changed: string[]): string[] | undefined {
  if (changed.some((f) => EVERYTHING.includes(f))) return undefined;
  const files = ["src", "test", "scripts", "ui", "pi", "bin"].filter((d) => existsSync(join(root, d))).flatMap((d) => walk(root, d));
  const text = new Map(files.map((f) => [f, readFileSync(join(root, f), "utf8")]));
  const by = new Map<string, Set<string>>();
  for (const file of files) {
    for (const m of (text.get(file) ?? "").matchAll(IMPORT)) {
      const target = resolveImport(root, file, m[1] ?? "");
      if (target) by.set(target, (by.get(target) ?? new Set()).add(file));
    }
  }
  const reached = new Set(changed);
  const queue = [...changed];
  for (let f = queue.pop(); f !== undefined; f = queue.pop()) {
    const fresh = [...(by.get(f) ?? [])].filter((up) => !reached.has(up));
    for (const up of fresh) reached.add(up);
    queue.push(...fresh);
  }
  const named = [...reached].filter((f) => !CODE.test(f) || f === "bin/lineclear" || f.startsWith("scripts/"));
  return files.filter((t) => TEST.test(t) && (reached.has(t) || named.some((f) => text.get(t)?.includes(f))));
}

// The specs a view's code is tested by; code not listed here (the kit, brand, frame, routes, build, shared helpers) runs them all.
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
  const specs = new Set<string>();
  for (const f of changed.filter((f) => f.startsWith("ui/") || f === "playwright.config.ts")) {
    const own = /^ui\/test\/([\w-]+)\.pw\.ts$/.exec(f);
    if (own) specs.add(own[1] ?? "");
    // screenshots and notes in ui/test/screens and the like belong to no code
    else if (/^ui\/test\/screens\//.test(f) || /\.(md|json|svg|jpg)$/.test(f)) continue;
    else {
      const view = VIEW_SPECS.find(([re]) => re.test(f));
      if (!view) return undefined;
      for (const s of view[1]) specs.add(s);
    }
  }
  return [...specs].map((s) => `ui/test/${s}.pw.ts`);
}

if (import.meta.main && process.argv[2] === "ui") {
  const specs = specsFor(changedSince(".", "main") ?? []);
  const sh = (cmd: string[]) => Bun.spawnSync(cmd, { stdin: "ignore", stdout: "inherit", stderr: "inherit" }).exitCode ?? 1;
  if (specs?.length === 0) console.log("ui:changed: no view changed, no spec to run");
  else {
    if (sh(["bun", "run", "web:build"]) !== 0) process.exit(1);
    console.log(specs ? `ui:changed: ${specs.join(" ")}` : "ui:changed: shared ui code changed, all specs run");
    process.exit(sh(["bunx", "playwright", "test", ...(specs ?? [])]));
  }
}
