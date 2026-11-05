import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ownerOf, type Part, stepFiles, stepParts } from "./parts.ts";
import type { Step } from "./roadmap.ts";

/** One part's health: what counts against it, and its score (higher is worse). */
export interface Health {
  part: string;
  /** Files over the size limit, from the size baseline. */
  oversize: number;
  /** Lines copied between files, from the copies baseline. */
  copied: number;
  debts: number;
  /** Whole points the part's line coverage is under the floors of its modules, in steps of 5 (the last `bun run coverage`). */
  uncovered: number;
  /** Stalls, review findings and flaky tests in the tasks of steps that touched the part. */
  stalls: number;
  findings: number;
  flaky: number;
  score: number;
}

/** What the tasks of a space said, read from its chat: stalls, ready facts with their findings, flaky tests. */
export interface TaskSignals {
  stalls: number;
  findings: number;
  flaky: number;
}

/** The weights of `docs/architecture.md`'s health formula. */
export const scoreOf = (h: Omit<Health, "part" | "score">) =>
  3 * h.oversize + Math.floor(h.copied / 50) + h.debts + h.uncovered + 2 * h.stalls + h.findings + 2 * h.flaky;

const FINDINGS = /(\d+)\s+(?:critical|major|minor)\b/gi;

/** A card as Shepherdr posts it in a chat file. */
interface Posted {
  id?: unknown;
  card?: { id?: unknown; task?: unknown; text?: unknown; summary?: unknown };
}

const none = (): TaskSignals => ({ stalls: 0, findings: 0, flaky: 0 });

/** Each task's stalls and flaky tests from the cards of a space's chat files, each card once. */
function cardSignals(files: { posted?: Posted[] }[], out: Map<string, TaskSignals>): void {
  const seen = new Set<string>();
  for (const p of files.flatMap((f) => f.posted ?? [])) {
    const c = p.card;
    const id = String(c?.id ?? p.id);
    if (typeof c?.task !== "string" || seen.has(id)) continue;
    seen.add(id);
    const s = out.get(c.task) ?? none();
    if (/^may be stuck/.test(String(c.text ?? ""))) s.stalls++;
    if (/\bflaky\b/i.test(`${c.text ?? ""}\n${c.summary ?? ""}`)) s.flaky++;
    out.set(c.task, s);
  }
}

/** Each task's stalls and flaky tests from its chat cards, and its review findings and flaky tests from its ready facts. */
export function taskSignals(files: { posted?: Posted[] }[], tasks: { id: string; facts?: string }[] = []): Map<string, TaskSignals> {
  const out = new Map<string, TaskSignals>();
  cardSignals(files, out);
  for (const t of tasks) {
    if (typeof t.facts !== "string") continue;
    const s = out.get(t.id) ?? none();
    for (const m of t.facts.matchAll(FINDINGS)) s.findings += Number(m[1]);
    if (/\bflaky\b/i.test(t.facts)) s.flaky++;
    out.set(t.id, s);
  }
  return out;
}

const json = (file: string): Record<string, number> => {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  } catch {
    return {};
  }
};

/** The parts a step touched: the ones it names, else the owners of its files. */
function touched(step: Step, parts: Part[]): string[] {
  const named = stepParts(step).names;
  if (named.length > 0) return named;
  return [...new Set(stepFiles(step).flatMap((f) => ownerOf(f, parts)?.name ?? []))];
}

/** Points under the floors, from the last `bun run coverage` (`.coverage/files.json`); none recorded, none counted. */
function addCoverage(repo: string, parts: Part[], health: Map<string, Health>): void {
  const covered = new Map<string, { hit: number; found: number; floored: number }>();
  const measured = json(join(repo, ".coverage", "files.json")) as unknown as Record<string, { hit: number; found: number; floor: number }>;
  for (const [file, c] of Object.entries(measured)) {
    const name = ownerOf(file, parts)?.name ?? "";
    const sum = covered.get(name) ?? { hit: 0, found: 0, floored: 0 };
    covered.set(name, { hit: sum.hit + c.hit, found: sum.found + c.found, floored: sum.floored + c.floor * c.found });
  }
  for (const [name, c] of covered) {
    const h = health.get(name);
    if (h && c.found > 0) h.uncovered = Math.max(0, Math.ceil((c.floored - 100 * c.hit) / c.found / 5));
  }
}

/**
 * Every part's health. The size and copies baselines are the repo's own (`scripts/gates/baseline/`); a task counts
 * for a step when its title starts with the step's id.
 */
export function partHealth(repo: string, parts: Part[], steps: Step[], tasks: { id: string; title: string }[], signals: Map<string, TaskSignals>): Health[] {
  const base = join(repo, "scripts", "gates", "baseline");
  const health = new Map(
    parts.map((p) => [p.name, { part: p.name, oversize: 0, copied: 0, debts: p.debts.length, uncovered: 0, stalls: 0, findings: 0, flaky: 0, score: 0 }]),
  );
  const of = (file: string) => health.get(ownerOf(file, parts)?.name ?? "");
  for (const file of Object.keys(json(join(base, "size.json")))) {
    const h = of(file);
    if (h) h.oversize++;
  }
  for (const [pair, lines] of Object.entries(json(join(base, "copies.json")))) {
    // a copy between two parts counts for both
    for (const name of new Set(pair.split(" = ").map((f) => ownerOf(f.trim(), parts)?.name))) {
      const h = health.get(name ?? "");
      if (h) h.copied += lines;
    }
  }
  addCoverage(repo, parts, health);
  for (const step of steps) {
    const ts = tasks.filter((t) => t.title.startsWith(`${step.id} `)).flatMap((t) => signals.get(t.id) ?? []);
    if (ts.length === 0) continue;
    for (const name of touched(step, parts)) {
      const h = health.get(name);
      if (!h) continue;
      for (const s of ts) {
        h.stalls += s.stalls;
        h.findings += s.findings;
        h.flaky += s.flaky;
      }
    }
  }
  const out = [...health.values()];
  for (const h of out) h.score = scoreOf(h);
  return out.sort((a, b) => b.score - a.score || a.part.localeCompare(b.part));
}

/** The parts with the worst score: the ones a health step is for. */
export function worstParts(health: Health[]): string[] {
  const top = Math.max(0, ...health.map((h) => h.score));
  return health.filter((h) => h.score === top).map((h) => h.part);
}

/** The lines `lineclear measure` prints for part health, worst first. */
export function healthLines(health: Health[]): string[] {
  if (health.length === 0) return [];
  return [
    "part health (higher is worse): part  score  oversize  copied  debts  uncovered  stalls  findings  flaky",
    ...health.map(
      (h) =>
        `  ${h.part.padEnd(10)} ${String(h.score).padStart(5)}  ${String(h.oversize).padStart(8)}  ${String(h.copied).padStart(6)}  ${String(h.debts).padStart(5)}  ${String(h.uncovered).padStart(9)}  ${String(h.stalls).padStart(6)}  ${String(h.findings).padStart(8)}  ${String(h.flaky).padStart(5)}`,
    ),
  ];
}
