// `lineclear parts check`: the pages in docs/parts/ stay true. Every file has one part, every name another part uses
// is on its part's page, an interface that changed since main changed its page too, and each interface has its
// contract test. No AI.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contractOf, declaration, ownerOf, PAGE_MAX_LINES, type Part, PARTS_DIR, readParts, SECTIONS, scopeFaults, usedInterface } from "./parts.ts";
import { parseRoadmap } from "./roadmap.ts";
import { mainRef } from "./main-branch.ts";
import { git } from "./git.ts";

type Out = (line: string) => void;
const ARCHITECTURE = "docs/architecture.md";

/** What a change since main looks like: the commit it left main at, and the files it changed (the work tree too). */
export interface Since {
  base: string;
  changed: Set<string>;
  /** The branch the work is on: `work/<n>-<step id>-...` names its step. */
  branch?: string;
  /** A file as it was at `base`, or undefined when it did not exist. */
  before(file: string): string | undefined;
}

function pageFaults(p: Part): string[] {
  const out: string[] = [];
  const lines = p.text.trimEnd().split("\n");
  if (lines[0] !== `# ${p.name}`) out.push(`${p.page}: the first line is '# ${p.name}'`);
  const purpose = lines
    .slice(
      1,
      lines.findIndex((l) => l.startsWith("## ")),
    )
    .join("")
    .trim();
  if (purpose === "") out.push(`${p.page}: no purpose: say what the part is for under its title`);
  for (const s of SECTIONS) if (!(s in p.sections)) out.push(`${p.page}: no '## ${s}' section`);
  if (lines.length > PAGE_MAX_LINES) out.push(`${p.page}: ${lines.length} lines, a page has at most ${PAGE_MAX_LINES}`);
  return out;
}

/** The parts table of docs/architecture.md: the names in its first column under `## Parts`. */
function tableParts(markdown: string): string[] {
  const at = markdown.search(/^## Parts$/m);
  if (at < 0) return [];
  const rest = markdown.slice(at).split("\n").slice(1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).map((l) => /^\| `([^`]+)` \|/.exec(l)?.[1]).filter((n): n is string => n !== undefined);
}

function ownershipFaults(parts: Part[], tracked: string[]): string[] {
  const out: string[] = [];
  const seen = new Map<string, string>();
  for (const p of parts) {
    for (const f of p.files) {
      const other = seen.get(f);
      if (other) out.push(`${f} is listed by part ${other} and part ${p.name}: a file has one part`);
      seen.set(f, p.name);
      if (!tracked.some((t) => (f.endsWith("/") ? t.startsWith(f) : t === f))) out.push(`${p.page}: ${f} is listed under Files but holds no file`);
    }
    // a command such as `bun run ui:test` is a test too, but not a path to look for
    const paths = p.tests.filter((t) => t.includes("/") && !t.includes(" "));
    for (const t of paths) if (!tracked.some((f) => (t.endsWith("/") ? f.startsWith(t) : f === t))) out.push(`${p.page}: the test ${t} does not exist`);
  }
  const loose = tracked.filter((t) => !ownerOf(t, parts));
  for (const t of loose.slice(0, 20)) out.push(`${t} is in no part: add it under Files on one page in ${PARTS_DIR}/`);
  if (loose.length > 20) out.push(`and ${loose.length - 20} more files in no part`);
  return out;
}

/** The names other parts use that a page does not list, and the ones it lists that nobody uses. */
function listedFaults(p: Part, uses: Map<string, Set<string>>): string[] {
  const out: string[] = [];
  for (const [file, names] of uses) {
    const listed = p.api.get(file) ?? new Set<string>();
    const missing = [...names].filter((n) => !listed.has(n));
    if (missing.length > 0) out.push(`${p.page}: other parts use ${missing.map((n) => `\`${n}\``).join(", ")} of ${file}: list them under Interface`);
  }
  for (const [file, listed] of p.api) {
    const names = uses.get(file) ?? new Set<string>();
    const extra = [...listed].filter((n) => !names.has(n));
    if (extra.length > 0) out.push(`${p.page}: no other part uses ${extra.map((n) => `\`${n}\``).join(", ")} of ${file}: take them off Interface`);
  }
  return out;
}

/** A part with an interface has its contract test, listed under Tests, or owes it under Debts. */
function contractFaults(p: Part, tracked: string[]): string[] {
  const contract = contractOf(p.name);
  // a part written before its contract test names it as a debt, so its health shows it until it lands
  const owed = p.debts.some((d) => d.includes(`\`${contract}\``));
  if (!tracked.includes(contract))
    return owed ? [] : [`${p.page}: part ${p.name} has an interface and no contract test ${contract}: write it, or name it under Debts`];
  if (owed) return [`${p.page}: ${contract} exists: take it off Debts`];
  return p.tests.includes(contract) ? [] : [`${p.page}: list its contract test ${contract} under Tests`];
}

function interfaceFaults(repo: string, parts: Part[], tracked: string[], since?: Since): string[] {
  const used = usedInterface(repo, tracked, parts);
  return parts.flatMap((p) => {
    const uses = used.get(p.name) ?? new Map<string, Set<string>>();
    return [
      ...listedFaults(p, uses),
      ...(uses.size > 0 ? contractFaults(p, tracked) : []),
      ...(since && !since.changed.has(p.page) ? changedFaults(repo, p, uses, since) : []),
    ];
  });
}

/** An interface whose declaration changed since main while its page did not. */
function changedFaults(repo: string, p: Part, uses: Map<string, Set<string>>, since: Since): string[] {
  const out: string[] = [];
  for (const [file, names] of uses) {
    if (!since.changed.has(file)) continue;
    const was = since.before(file);
    if (was === undefined) continue;
    const now = readFileSync(join(repo, file), "utf8");
    const moved = [...names].filter((n) => n !== "*" && n !== "default" && declaration(was, n) !== declaration(now, n));
    if (moved.length > 0) {
      out.push(`${file} changed the interface ${moved.map((n) => `\`${n}\``).join(", ")} of part ${p.name} since main: update ${p.page} in the same change`);
    }
  }
  return out;
}

/** The branch `work/<n>-l215-...` is for step L215, as the roadmap in the work tree names it. */
function scopeOfBranch(repo: string, parts: Part[], since: Since): string[] {
  const id = /^work\/\d+-([a-z]+\d+)(?:-|$)/.exec(since.branch ?? "")?.[1]?.toUpperCase();
  const roadmap = existsSync(join(repo, "docs/ROADMAP.md")) ? readFileSync(join(repo, "docs/ROADMAP.md"), "utf8") : undefined;
  const step = id === undefined || roadmap === undefined ? undefined : parseRoadmap(roadmap).steps.find((s) => s.id === id);
  if (id !== undefined && step === undefined) return [`step ${id} of branch ${since.branch} is not in docs/ROADMAP.md`];
  // a deleted file has no part left to own it
  return step === undefined
    ? []
    : scopeFaults(
        step,
        [...since.changed].filter((p) => existsSync(join(repo, p))),
        parts,
      );
}

/** Every fault of a repo's parts; none for a repo with no parts. */
export function partsFaults(repo: string, tracked: string[], since?: Since): string[] {
  const parts = readParts(repo);
  if (parts.length === 0) return [];
  const out = parts.flatMap(pageFaults);
  const arch = join(repo, ARCHITECTURE);
  if (existsSync(arch)) {
    const table = tableParts(readFileSync(arch, "utf8"));
    const names = parts.map((p) => p.name);
    for (const n of names.filter((n) => !table.includes(n))) out.push(`${ARCHITECTURE}: part ${n} is not in its Parts table`);
    for (const n of table.filter((n) => !names.includes(n))) out.push(`${ARCHITECTURE}: the Parts table names ${n}, which has no page in ${PARTS_DIR}/`);
  }
  out.push(...ownershipFaults(parts, tracked), ...interfaceFaults(repo, parts, tracked, since), ...(since ? scopeOfBranch(repo, parts, since) : []));
  return out;
}

/** The repo's files, new ones not yet added included, and what changed since it left main. */
export function repoState(repo: string): { tracked: string[]; since?: Since } {
  const lines = (s: string) => s.split("\n").filter(Boolean);
  const tracked = lines(git(repo, "ls-files", "--cached", "--others", "--exclude-standard").out).filter((f) => existsSync(join(repo, f)));
  const main = mainRef(repo);
  const base = main ? git(repo, "merge-base", "HEAD", main).out.trim() : "";
  if (!base) return { tracked };
  const changed = new Set([...lines(git(repo, "diff", "--name-only", base).out), ...lines(git(repo, "ls-files", "--others", "--exclude-standard").out)]);
  const before = (file: string) => {
    const r = git(repo, "show", `${base}:${file}`);
    return r.ok ? r.out : undefined;
  };
  return { tracked, since: { base, changed, before, branch: git(repo, "branch", "--show-current").out.trim() } };
}

export function partsMain(args: string[], out: Out): number {
  const [sub, repo = ".", ...extra] = args;
  if (sub !== "check" || extra.length > 0) {
    out("usage: lineclear parts check [<repo>]");
    return 2;
  }
  const parts = readParts(repo);
  if (parts.length === 0) {
    out(`ok: no parts (${PARTS_DIR}/ has no page)`);
    return 0;
  }
  const { tracked, since } = repoState(repo);
  const faults = partsFaults(repo, tracked, since);
  for (const f of faults) out(f);
  if (faults.length > 0) return 1;
  out(`ok: ${parts.length} parts, every file in one, every interface on its page`);
  return 0;
}
