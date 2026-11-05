// The ratchet every gate shares. A gate finds faults; each fault has a key (a file and a rule) and the baseline counts
// how many faults of each key main had when the gate landed. More than the baseline fails, and so does a baseline
// that counts more than is found: a fix lowers the baseline in the same commit, so it only ever shrinks.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Fault {
  /** what the baseline counts: a file and a rule, with no line number, so an edit above it does not move it */
  key: string;
  /** where and what, for the person who fixes it */
  text: string;
  /** how much of the key this fault is, 1 unless said: a file's lines, a copy's lines */
  count?: number;
}

export interface Gate {
  name: string;
  /** with `files`, the gate looks at those files only (a gate with `perFile` set) */
  find(root: string, files?: string[]): Promise<Fault[]>;
  /** set when a file's faults follow from that file and the `config` files alone, and each key starts with the file */
  perFile?: { config: string[] };
  /** true when the gate's cache is empty, so its time says nothing about a usual run */
  cold?(root: string): boolean;
}

export type Counts = Record<string, number>;

export interface Verdict {
  /** keys with more faults than the baseline allows, each with its faults */
  over: { key: string; found: number; allowed: number; faults: Fault[] }[];
  /** keys the baseline counts higher than what is found */
  stale: { key: string; found: number; allowed: number }[];
}

function tally(faults: Fault[]): Counts {
  const counts: Counts = {};
  for (const f of faults) counts[f.key] = (counts[f.key] ?? 0) + (f.count ?? 1);
  return counts;
}

export function judge(faults: Fault[], baseline: Counts): Verdict {
  const found = tally(faults);
  const over = Object.entries(found)
    .filter(([key, n]) => n > (baseline[key] ?? 0))
    .map(([key, n]) => ({ key, found: n, allowed: baseline[key] ?? 0, faults: faults.filter((f) => f.key === key) }));
  const stale = Object.entries(baseline)
    .filter(([key, n]) => n > (found[key] ?? 0))
    .map(([key, n]) => ({ key, found: found[key] ?? 0, allowed: n }));
  return { over, stale };
}

/** The baseline with each count brought down to what is found. It never raises a count or adds a key. */
export function lower(faults: Fault[], baseline: Counts): Counts {
  const found = tally(faults);
  const out: Counts = {};
  for (const [key, n] of Object.entries(baseline)) {
    const m = Math.min(n, found[key] ?? 0);
    if (m > 0) out[key] = m;
  }
  return out;
}

/** The file a key of a `perFile` gate is about: the key up to its first space. */
const fileOf = (key: string): string => key.split(" ")[0] ?? key;

/** The part of a baseline about `files`. */
export function within(baseline: Counts, files: Set<string>): Counts {
  return Object.fromEntries(Object.entries(baseline).filter(([key]) => files.has(fileOf(key))));
}

const baselineFile = (root: string, gate: string) => join(root, "scripts", "gates", "baseline", `${gate}.json`);

export function readBaseline(root: string, gate: string): Counts {
  const file = baselineFile(root, gate);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Counts) : {};
}

export function writeBaseline(root: string, gate: string, counts: Counts): void {
  const file = baselineFile(root, gate);
  mkdirSync(dirname(file), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}
