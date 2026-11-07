// Module borders: which module may import which. Each module states its border in the first lines of its folder's
// README.md (see docs/architecture.md), so adding a module edits no central file.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { trackedFiles } from "./tools.ts";

interface Module {
  name: string;
  readme: string;
  folders: string[];
  imports: string[];
  lines: number;
}

const ARCHITECTURE = "docs/architecture.md";
// the server's tsconfig paths
const ALIASES: Record<string, string> = { "@shared/": "server/shared/" };
const CODE = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");
const SOURCE = /\.(ts|tsx|mts|js|mjs)$/;
const KEY = /^(Module|Covers|Owns|May import|Lines):\s*(.*)$/;

/**
 * The modules a README declares in its leading lines: blocks of `Key: value` lines (`Module`, `Covers`, `Owns`,
 * `May import`, `Lines`) split by blank lines, after an optional `# title`. Reading stops at the first other line.
 * `Module` defaults to the folder's name and `Covers` to the folder.
 */
function readModules(readme: string, markdown: string, faults: string[]): Module[] {
  const folder = dirname(readme) === "." ? "" : `${dirname(readme)}/`;
  const blocks: Record<string, string>[] = [];
  let block: Record<string, string> = {};
  const close = () => {
    if (Object.keys(block).length > 0) blocks.push(block);
    block = {};
  };
  for (const line of markdown.split("\n")) {
    const m = KEY.exec(line.trim());
    if (m) block[m[1] ?? ""] = m[2] ?? "";
    else if (line.trim() === "" || line.startsWith("# ")) close();
    else break;
  }
  close();
  const modules: Module[] = [];
  for (const b of blocks) {
    const missing = ["Owns", "May import", "Lines"].filter((k) => b[k] === undefined);
    if (missing.length > 0) {
      faults.push(`${readme} lacks ${missing.join(", ")} in its first lines`);
      continue;
    }
    const lines = Number(b.Lines);
    if (!Number.isInteger(lines) || lines <= 0) faults.push(`${readme}: Lines must be a whole number above 0, not "${b.Lines}"`);
    const name = CODE(b.Module ?? "")[0] ?? (folder.split("/").filter(Boolean).pop() || "root");
    const covers = CODE(b.Covers ?? "");
    modules.push({ name, readme, folders: covers.length > 0 ? covers : [folder], imports: CODE(b["May import"] ?? ""), lines });
  }
  return modules;
}

function moduleOf(file: string, modules: Module[]): Module | undefined {
  let best: { m: Module; len: number } | undefined;
  for (const m of modules) {
    for (const f of m.folders) {
      const hit = f.endsWith("/") ? file.startsWith(f) : file === f;
      if (hit && (!best || f.length > best.len)) best = { m, len: f.length };
    }
  }
  return best?.m;
}

interface Import {
  spec: string;
  line: number;
  typeOnly: boolean;
}

const STATIC = /^\s*(import|export)\s+(type\s+)?(?:([^;'"]*?)\s*from\s*)?["']([^"']+)["']/gm;
const DYNAMIC = /\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g;

function scanImports(source: string): Import[] {
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
  return tries.find(isFile) ?? base;
}

interface Scan {
  modules: Module[];
  edges: { from: string; to: string; line: number; typeOnly: boolean }[];
  files: string[];
  faults: string[];
}

const scans = new Map<string, Promise<Scan>>();

function scan(root: string): Promise<Scan> {
  let s = scans.get(root);
  if (!s) {
    s = (async () => {
      const faults: string[] = [];
      const modules = trackedFiles(root, /(^|\/)README\.md$/).flatMap((f) => readModules(f, readFileSync(join(root, f), "utf8"), faults));
      const files = trackedFiles(root, SOURCE);
      const edges: Scan["edges"] = [];
      for (const from of files) {
        for (const imp of scanImports(readFileSync(join(root, from), "utf8"))) {
          const to = resolveImport(root, from, imp.spec);
          if (to !== undefined) edges.push({ from, to, line: imp.line, typeOnly: imp.typeOnly });
        }
      }
      return { modules, edges, files, faults };
    })();
    scans.set(root, s);
  }
  return s;
}

function sizeFaults(root: string, files: string[], modules: Module[]): string[] {
  const used = new Map<Module, number>();
  for (const file of files) {
    const m = moduleOf(file, modules);
    if (m) used.set(m, (used.get(m) ?? 0) + readFileSync(join(root, file), "utf8").split("\n").length);
  }
  return [...used].filter(([m, n]) => n > m.lines).map(([m, n]) => `${m.name} has ${n} lines, over the ${m.lines} that ${m.readme} allows`);
}

export async function borders(root: string): Promise<string[]> {
  const { modules, edges, files, faults: declared } = await scan(root);
  const faults = [...declared];
  const names = new Set<string>();
  for (const m of modules) {
    if (names.has(m.name)) faults.push(`${m.readme}: module ${m.name} is declared twice`);
    names.add(m.name);
  }
  for (const m of modules) {
    for (const i of m.imports) if (!names.has(i)) faults.push(`${m.readme}: ${m.name} may import ${i}, which is no module`);
  }
  for (const file of files) {
    if (!moduleOf(file, modules)) faults.push(`${file} is in no module: its folder needs a README.md with Owns, May import and Lines (${ARCHITECTURE})`);
  }
  for (const e of edges) {
    const a = moduleOf(e.from, modules);
    const b = moduleOf(e.to, modules);
    if (!a || !b || a === b || a.imports.includes(b.name)) continue;
    faults.push(`${e.from}:${e.line} imports ${e.to}: ${a.name} may not import ${b.name} (${a.readme})`);
  }
  return [...faults, ...sizeFaults(root, files, modules)];
}
