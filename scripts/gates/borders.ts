// Module borders and import cycles. The modules and which may import which come from the table in
// docs/architecture.md, so the doc and the check cannot differ.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { Fault, Gate } from "./ratchet.ts";
import { trackedFiles } from "./tools.ts";

export interface Module {
  name: string;
  folders: string[];
  imports: string[];
}

const ARCHITECTURE = "docs/architecture.md";
// the server's tsconfig paths
const ALIASES: Record<string, string> = { "@shared/": "server/shared/", "@client/": "server/src/", "@plugins/": "server/plugins/" };
const CODE = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");

/** The rows of the modules table: | `name` | `folder/`, `file.ts` | owns | `a`, `b` or none | */
export function readModules(markdown: string): Module[] {
  const modules: Module[] = [];
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 6 || !cells[1]?.startsWith("`")) continue;
    const [name] = CODE(cells[1]);
    if (name) modules.push({ name, folders: CODE(cells[2] ?? ""), imports: CODE(cells[4] ?? "") });
  }
  return modules;
}

export function moduleOf(file: string, modules: Module[]): Module | undefined {
  let best: { m: Module; len: number } | undefined;
  for (const m of modules) {
    for (const f of m.folders) {
      const hit = f.endsWith("/") ? file.startsWith(f) : file === f;
      if (hit && (!best || f.length > best.len)) best = { m, len: f.length };
    }
  }
  return best?.m;
}

export interface Import {
  spec: string;
  line: number;
  typeOnly: boolean;
}

const STATIC = /^\s*(import|export)\s+(type\s+)?(?:([^;'"]*?)\s*from\s*)?["']([^"']+)["']/gm;
const DYNAMIC = /\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g;

export function scanImports(source: string): Import[] {
  const lineAt = (i: number) => source.slice(0, i).split("\n").length;
  const out: Import[] = [];
  for (const m of source.matchAll(STATIC)) {
    const names = m[3] ?? "";
    // `import { type A, type B }` is gone at run time like `import type`
    const allTypes = /^\{[^}]*\}$/.test(names.trim()) && names.split(",").every((n) => /^\s*\{?\s*(type\s|\}|$)/.test(n));
    if (m[1] === "export" && !names && !m[2]) continue; // `export "x"` is not an import
    out.push({ spec: m[4] ?? "", line: lineAt(m.index ?? 0), typeOnly: Boolean(m[2]) || (names !== "" && allTypes) });
  }
  for (const m of source.matchAll(DYNAMIC)) out.push({ spec: m[1] ?? "", line: lineAt(m.index ?? 0), typeOnly: false });
  return out;
}

/** The repo file an import names, or undefined for a package. */
function resolveImport(root: string, from: string, spec: string): string | undefined {
  let base: string | undefined;
  if (spec.startsWith(".")) base = normalize(join(dirname(from), spec));
  else if (from.startsWith("server/")) {
    const alias = Object.keys(ALIASES).find((a) => spec.startsWith(a));
    if (alias) base = ALIASES[alias] + spec.slice(alias.length);
  }
  if (base === undefined) return undefined;
  const isFile = (p: string) => existsSync(join(root, p)) && statSync(join(root, p)).isFile();
  const tries = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  // a file the build writes (server/generated/) is not on disk in a fresh checkout: keep its path
  return tries.find(isFile) ?? base;
}

interface Scan {
  modules: Module[];
  edges: { from: string; to: string; line: number; typeOnly: boolean }[];
  files: string[];
}

const scans = new Map<string, Promise<Scan>>();

function scan(root: string): Promise<Scan> {
  let s = scans.get(root);
  if (!s) {
    s = (async () => {
      const modules = readModules(readFileSync(join(root, ARCHITECTURE), "utf8"));
      const files = trackedFiles(root);
      const edges: Scan["edges"] = [];
      for (const from of files) {
        for (const imp of scanImports(readFileSync(join(root, from), "utf8"))) {
          const to = resolveImport(root, from, imp.spec);
          if (to !== undefined) edges.push({ from, to, line: imp.line, typeOnly: imp.typeOnly });
        }
      }
      return { modules, edges, files };
    })();
    scans.set(root, s);
  }
  return s;
}

export const borders: Gate = {
  name: "borders",
  async find(root) {
    const { modules, edges, files } = await scan(root);
    const faults: Fault[] = [];
    for (const file of files) {
      if (!moduleOf(file, modules)) faults.push({ key: `${file} no-module`, text: `${file} is in no module of ${ARCHITECTURE}` });
    }
    for (const e of edges) {
      const a = moduleOf(e.from, modules);
      const b = moduleOf(e.to, modules);
      if (!a || !b || a === b || a.imports.includes(b.name)) continue;
      faults.push({ key: `${e.from} > ${e.to}`, text: `${e.from}:${e.line} imports ${e.to}: ${a.name} may not import ${b.name} (${ARCHITECTURE})` });
    }
    return faults;
  },
};

/** The groups of files that import each other at run time (Tarjan's strongly connected components). */
export function cyclesOf(graph: Map<string, string[]>): string[][] {
  let next = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const groups: string[][] = [];
  const visit = (v: string) => {
    index.set(v, next);
    low.set(v, next++);
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v) ?? 0, index.get(w) ?? 0));
    }
    if (low.get(v) !== index.get(v)) return;
    const group: string[] = [];
    let w: string | undefined;
    do {
      w = stack.pop();
      if (w === undefined) break;
      onStack.delete(w);
      group.push(w);
    } while (w !== v);
    if (group.length > 1 || graph.get(v)?.includes(v)) groups.push(group.sort());
  };
  for (const v of graph.keys()) if (!index.has(v)) visit(v);
  return groups;
}

export const cycles: Gate = {
  name: "cycles",
  async find(root) {
    const { edges } = await scan(root);
    const runtime = edges.filter((e) => !e.typeOnly);
    const graph = new Map<string, string[]>();
    for (const e of runtime) graph.set(e.from, [...(graph.get(e.from) ?? []), e.to]);
    const groupOf = new Map<string, string[]>();
    for (const group of cyclesOf(graph)) for (const f of group) groupOf.set(f, group);
    // one fault per import inside a cycle, so breaking one import of a big cycle lowers the count and moves nothing
    return runtime
      .filter((e) => groupOf.get(e.from) !== undefined && groupOf.get(e.from) === groupOf.get(e.to))
      .map((e) => ({ key: `${e.from} > ${e.to}`, text: `${e.from}:${e.line} imports ${e.to}, in a cycle of ${groupOf.get(e.from)?.length} files` }));
  },
};
