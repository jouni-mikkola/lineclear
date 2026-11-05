// A repo's parts: each has a page in docs/parts/ with its purpose, invariants, interface, files, tests and debts.
// A part is kept like a team keeps its code: the page says what must stay true, and the check below keeps the page
// true. No AI: the pages, git and the imports between files are all it reads.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { Step } from "./roadmap.ts";

export const PARTS_DIR = "docs/parts";
/** The sections every page has, in its order. */
export const SECTIONS = ["Invariants", "Interface", "Files", "Tests", "Debts"] as const;
/** One page: what fits on a screen, so a worker's brief can carry it whole. */
export const PAGE_MAX_LINES = 45;
export const HEALTH_TAG = "(health)";

export interface Part {
  name: string;
  /** The page's path in the repo. */
  page: string;
  text: string;
  sections: Record<string, string[]>;
  /** Paths it owns: a folder ends in `/`. */
  files: string[];
  /** The names other parts may use, by file. */
  api: Map<string, Set<string>>;
  tests: string[];
  debts: string[];
}

const CODE = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");

/** The bullets of each `## ` section of a page; a bullet's continuation lines join it. */
function sectionsOf(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let cur: string[] | undefined;
  for (const line of text.split("\n")) {
    const h = /^## (.+)$/.exec(line);
    if (h) out[(h[1] as string).trim()] = cur = [];
    else if (cur && line.startsWith("- ")) cur.push(line.slice(2).trim());
    else if (cur && /^\s+\S/.test(line) && cur.length > 0) cur[cur.length - 1] += ` ${line.trim()}`;
  }
  return out;
}

export function parsePart(name: string, text: string): Part {
  const sections = sectionsOf(text);
  const api = new Map<string, Set<string>>();
  for (const b of sections.Interface ?? []) {
    const m = /^`([^`]+)`:(.*)$/.exec(b);
    if (m) api.set(m[1] as string, new Set(CODE(m[2] as string)));
  }
  return {
    name,
    page: `${PARTS_DIR}/${name}.md`,
    text,
    sections,
    files: (sections.Files ?? []).flatMap(CODE),
    api,
    tests: (sections.Tests ?? []).flatMap(CODE),
    debts: (sections.Debts ?? []).filter((d) => !/^none\.?$/i.test(d)),
  };
}

/** The parts of a repo, by their pages; none when it has no `docs/parts/`. */
export function readParts(repo: string): Part[] {
  const dir = join(repo, PARTS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((f) => parsePart(f.slice(0, -3), readFileSync(join(dir, f), "utf8")));
}

/** Where a part's contract test lives: one per interface, the part's own. */
export const contractOf = (part: string) => `test/contracts/${part}.test.ts`;

/** The part that owns a path: the one with the longest entry that holds it. A part's page and contract test are its own. */
export function ownerOf(path: string, parts: Part[]): Part | undefined {
  let best: { p: Part; len: number } | undefined;
  for (const p of parts) {
    if (path === p.page || path === contractOf(p.name)) return p;
    for (const f of p.files) {
      const hit = f.endsWith("/") ? path.startsWith(f) : path === f;
      if (hit && (!best || f.length > best.len)) best = { p, len: f.length };
    }
  }
  return best?.p;
}

/** The parts a step names, and which of them it is a health step for: `- parts: rules (health), inbox`. */
export function stepParts(step: Step): { names: string[]; health: string[] } {
  const f = step.fields.parts;
  const items = (f ? [f.value, ...f.more].join(",") : "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "" && s !== "none");
  const name = (s: string) => s.replace(HEALTH_TAG, "").trim();
  return { names: items.map(name), health: items.filter((s) => s.includes(HEALTH_TAG)).map(name) };
}

const ownLocks = (step: Step) => (step.fields.locks?.value ?? "").split(/[,\s]+/).filter((l) => l !== "" && l !== "none");

/** What a step needs free to start: its own locks when it names any, else each of its parts whole. */
export function stepLocks(step: Step): string[] {
  const locks = ownLocks(step);
  return [...new Set(locks.length > 0 ? locks : stepParts(step).names)];
}

/** A step that locks by its files: it names some, and has no locks of its own. */
const byFiles = (step: Step) => ownLocks(step).length === 0 && stepFiles(step).length > 0;

/** A step with parts that names no locks and no files: it holds each of its parts whole, and every other step of them waits. */
export const holdsPartsWhole = (step: Step) => stepParts(step).names.length > 0 && ownLocks(step).length === 0 && stepFiles(step).length === 0;

const FILE = "file:";
const someKey = (part: string) => `~${part}`;

/** The parts a step holds or needs whole: all of them without locks of its own, else those a lock is named after. */
function wholeParts(step: Step): string[] {
  const { names } = stepParts(step);
  const locks = ownLocks(step);
  return locks.length === 0 ? names : names.filter((n) => locks.includes(n));
}

/**
 * What a running step holds: its locks (else its parts), and `=part` for each part it holds whole.
 * A part it holds not whole is held as `~part` (some of it), as is every part of a step that names files, which also
 * holds `file:path` for each file.
 */
export function stepHeld(step: Step): string[] {
  const { names } = stepParts(step);
  if (byFiles(step)) return [...new Set([...names.map(someKey), ...stepFiles(step).map((f) => FILE + f)])];
  const whole = wholeParts(step);
  const some = names.filter((n) => !whole.includes(n)).map(someKey);
  return [...new Set([...stepLocks(step), ...whole.map(wholeKey), ...some])];
}

/**
 * What a step needs free to start: its locks (else its parts), `~part` of each part it needs whole, and `=part` of
 * each other part. A step that names files needs only the whole-part holds free (`part`); its files go through `fileClash`.
 */
export function stepNeeds(step: Step): string[] {
  const { names } = stepParts(step);
  if (byFiles(step)) return [...new Set(names)];
  const whole = wholeParts(step);
  return [...new Set([...stepLocks(step), ...whole.map(someKey), ...names.filter((n) => !whole.includes(n)).map(wholeKey)])];
}

/** A held file of another step that overlaps one of this step's files (a directory prefix counts), as `file:path`. */
export function fileClash(step: Step, held: Iterable<string>): string | undefined {
  if (!byFiles(step)) return undefined;
  const mine = stepFiles(step);
  const overlap = (a: string, b: string) => {
    const dir = (p: string) => (p.endsWith("/") ? p : `${p}/`);
    return a === b || dir(a).startsWith(dir(b)) || dir(b).startsWith(dir(a));
  };
  for (const k of held) if (k.startsWith(FILE) && mine.some((f) => overlap(f, k.slice(FILE.length)))) return k;
  return undefined;
}

/** The ready steps that file locks let start now, which the old whole-part locks held back behind a running step. */
export function unblockedByFiles(ready: Step[], running: Step[]): Step[] {
  const heldNow = new Map<string, string>();
  const heldOld = new Set<string>();
  for (const r of running) {
    for (const l of stepHeld(r)) heldNow.set(l, r.id);
    for (const l of [...stepParts(r).names, ...ownLocks(r)]) heldOld.add(l);
  }
  const blockedNow = (s: Step) => stepNeeds(s).some((l) => heldNow.has(l)) || fileClash(s, heldNow.keys()) !== undefined;
  return ready.filter((s) => stepLocks(s).some((l) => heldOld.has(l)) && !blockedNow(s));
}

const wholeKey = (part: string) => `=${part}`;

/** The paths of a step's `files` line, backticks or not. */
export function stepFiles(step: Step): string[] {
  const f = step.fields.files;
  if (!f) return [];
  return [f.value, ...f.more]
    .join(",")
    .split(",")
    .map((s) => s.trim().replace(/^`|`$/g, ""))
    .filter((s) => s !== "" && s !== "none");
}

/** What is wrong with a step's parts and files against the repo's parts: unknown names, a file outside them. */
export function stepPartFaults(step: Step, parts: Part[]): string[] {
  const { names } = stepParts(step);
  const known = new Set(parts.map((p) => p.name));
  const out = names.filter((n) => !known.has(n)).map((n) => `step ${step.id} names an unknown part '${n}' (parts: ${[...known].join(", ")})`);
  for (const file of stepFiles(step)) {
    const owner = ownerOf(file, parts);
    if (!owner || !names.includes(owner.name))
      out.push(`step ${step.id} lists ${file}, which is ${owner ? `in part ${owner.name}` : "in no part"}, not in its parts`);
  }
  return out;
}

/** Files a task may always change: the roadmap and the numbers record where a step's proof is written. */
const ALWAYS_OK = new Set(["docs/ROADMAP.md", "docs/numbers.md"]);

/** The changed paths a step may not touch: with files named, only those; else only its parts. Empty for a step that names neither. */
export function scopeFaults(step: Step, changed: Iterable<string>, parts: Part[]): string[] {
  const { names } = stepParts(step);
  const files = stepFiles(step);
  if (names.length === 0 && files.length === 0) return [];
  const inFiles = (path: string) => files.some((f) => path === f || path.startsWith(f.endsWith("/") ? f : `${f}/`));
  const allowed = (path: string) => (files.length > 0 ? inFiles(path) : names.includes(ownerOf(path, parts)?.name ?? ""));
  return [...changed]
    .filter((path) => !ALWAYS_OK.has(path) && !allowed(path))
    .map((path) => `${path} is outside step ${step.id}: its files are ${files.join(", ") || "none"} and its parts ${names.join(", ") || "none"}`);
}

// ---- the imports between parts ----

const IMPORT = /^\s*(?:import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["'](\.[^"']+)["']/gm;

/** The names a file imports from each relative path: `*` for a whole module. */
function importedNames(source: string): { spec: string; names: string[] }[] {
  const out: { spec: string; names: string[] }[] = [];
  for (const m of source.matchAll(IMPORT)) {
    const clause = (m[2] as string).trim();
    const braces = /\{([^}]*)\}/.exec(clause);
    const names = braces
      ? (braces[1] as string)
          .split(",")
          .map(
            (n) =>
              n
                .trim()
                .replace(/^type\s+/, "")
                .split(/\s+as\s+/)[0] as string,
          )
          .filter(Boolean)
      : [];
    const outside = clause
      .replace(/\{[^}]*\}/, "")
      .replace(/,/g, " ")
      .trim();
    if (outside.includes("*")) names.push("*");
    else if (/^\w+$/.test(outside)) names.push("default");
    out.push({ spec: m[3] as string, names });
  }
  return out;
}

function resolve(repo: string, from: string, spec: string): string | undefined {
  const base = normalize(join(dirname(from), spec));
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((p) => existsSync(join(repo, p)) && !p.endsWith("/"));
}

/** A file that only tests: its imports use a part, they do not make its interface. */
const isTestFile = (f: string) => f.startsWith("test/") || f.startsWith("ui/test/") || /\.(test|pw)\.tsx?$/.test(f);

/** Per part, the names other parts' code (not their tests) imports from its files: the interface the page must list. */
export function usedInterface(repo: string, files: string[], parts: Part[]): Map<string, Map<string, Set<string>>> {
  const used = new Map<string, Map<string, Set<string>>>();
  for (const from of files) {
    if (!/\.tsx?$/.test(from) || isTestFile(from) || from.startsWith("server/")) continue;
    const a = ownerOf(from, parts);
    for (const imp of importedNames(readFileSync(join(repo, from), "utf8"))) {
      const to = resolve(repo, from, imp.spec);
      const b = to ? ownerOf(to, parts) : undefined;
      if (!to || !a || !b || a === b) continue;
      const byFile = used.get(b.name) ?? new Map<string, Set<string>>();
      const names = byFile.get(to) ?? new Set<string>();
      for (const n of imp.names) names.add(n);
      byFile.set(to, names);
      used.set(b.name, byFile);
    }
  }
  return used;
}

/**
 * The declaration of an exported name, as far as it is the interface: a function's or a const's head up to its body,
 * a type's or an interface's whole text. Undefined when the file does not export it by that name.
 */
export function declaration(source: string, name: string): string | undefined {
  const re = new RegExp(`^export (?:declare )?(?:async )?(function\\*?|const|let|class|interface|type|enum) ${name.replace(/\$/g, "\\$")}\\b`, "m");
  const m = re.exec(source);
  if (!m) return new RegExp(`^export \\{[^}]*\\b${name}\\b`, "m").test(source) ? "" : undefined;
  const rest = source.slice(m.index);
  if (m[1] === "interface" || m[1] === "type" || m[1] === "enum" || m[1] === "class") {
    // a body in braces runs to its closing brace at the line's start, a type alias without one to its semicolon
    const end = rest.slice(0, rest.indexOf("\n")).trimEnd().endsWith("{") ? rest.search(/\n\}/) : rest.search(/;\n|\n\}/);
    return rest.slice(0, end < 0 ? rest.length : end + 2).trim();
  }
  return rest.slice(0, headEnd(rest)).trim();
}

/** Where a function's or a const's head ends: its body's `{`, its arrow or its `;`, outside any brackets of its types. */
function headEnd(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (depth === 0 && (text.startsWith("{\n", i) || text.startsWith("=>", i) || text.startsWith(";\n", i))) return i;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
  }
  return text.length;
}
