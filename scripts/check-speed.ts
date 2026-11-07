// How long the check and its parts took, and the limits that keep it fast (docs/numbers.md, "The merge check's budget").
// A test file or spec over its limit that is not in scripts/gates/baseline/slow.json fails the check by name, and so does a
// check over its budget on a machine that was not busy. Seconds are scaled by the load the machine had when the run
// ended (or the start, when busier), so a busy machine fails nothing for being busy.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpus, loadavg } from "node:os";

/** Seconds one test case may take (the owner's budget: every test under 2 s). */
export const UNIT_LIMIT_S = 2;
export const SPEC_LIMIT_S = 20;
/** The budget run's measured time: its server start, the first view and one idle minute of two pages. */
export const BUDGET_RUN_S = 100;
/** The check's time on a machine that is not busy: 180 s, and the budget run (scripts/budget.ts) on top of it. */
export const BUDGET_S = 180 + BUDGET_RUN_S;
/** A file already over its limit may grow this much before it fails (the machine is shared): timing noise, not a license. */
const GROWTH = 3;
/** A file just over its limit is timing noise on a shared machine: it fails over this many times the limit. */
const NOISE = 1.3;
const BASELINE = "scripts/gates/baseline/slow.json";

export type Kind = "unit" | "spec";
export type Times = Map<string, number>;
export type Baseline = Record<string, number>;

/** Reads how many times busier than its cores the machine was since the start of the run: 1 when it was not busy. */
export function loadFactorMeter(read: () => number[] = loadavg): () => number {
  const start = read()[0] ?? 0;
  return () => {
    const [now = 0, recent = 0] = read();
    return Math.max(1, Math.max(start, now, recent) / cpus().length);
  };
}

/** The factor right now, or for a given load and cores: for a test or script that scales its own limits. */
export function loadFactor(load?: number, cores?: number): number {
  if (load === undefined && cores === undefined) return loadFactorMeter()();
  const [now = 0, recent = 0] = loadavg();
  return Math.max(1, (load ?? Math.max(now, recent)) / Math.max(1, cores ?? cpus().length));
}

/** Seconds per test file from `bun test --reporter=junit`. */
export function junitTimes(xml: string): Times {
  const times: Times = new Map();
  for (const m of xml.matchAll(/<testsuite name="([^"]+)"[^>]* time="([\d.]+)"/g)) {
    const [, file = "", seconds = "0"] = m;
    if (/\.test\.tsx?$/.test(file)) times.set(file, (times.get(file) ?? 0) + Number(seconds));
  }
  return times;
}

/** Seconds of the slowest test case in each file: the unit limit is per test, not per file. */
export function junitSlowestCase(xml: string): Times {
  const times: Times = new Map();
  for (const m of xml.matchAll(/<testcase name="[^"]*"[^>]* time="([\d.]+)"[^>]* file="([^"]+)"/g)) {
    const [, seconds = "0", file = ""] = m;
    if (/\.test\.tsx?$/.test(file)) times.set(file, Math.max(times.get(file) ?? 0, Number(seconds)));
  }
  return times;
}

interface JsonSuite {
  file?: string;
  suites?: JsonSuite[];
  specs?: { tests: { results: { duration: number }[] }[] }[];
}

const suiteMs = (s: JsonSuite): number =>
  (s.specs ?? []).reduce((n, spec) => n + spec.tests.reduce((m, t) => m + t.results.reduce((d, r) => d + r.duration, 0), 0), 0) +
  (s.suites ?? []).reduce((n, c) => n + suiteMs(c), 0);

/** Seconds per spec file from Playwright's json reporter: the sum of its tests, over every project (width). */
export function specTimes(json: string): Times {
  const times: Times = new Map();
  for (const s of (JSON.parse(json) as { suites?: JsonSuite[] }).suites ?? []) {
    // Playwright names a file relative to its testDir
    const file = s.file && `ui/test/${s.file}`;
    if (file) times.set(file, (times.get(file) ?? 0) + suiteMs(s) / 1000);
  }
  return times;
}

export function readSlowBaseline(root = "."): Baseline {
  const path = join(root, BASELINE);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Baseline) : {};
}

const limitOf = (kind: Kind) => (kind === "unit" ? UNIT_LIMIT_S : SPEC_LIMIT_S);

/** The files slower than they may be, slowest first, as lines that name the file and the limit it broke. */
export function slowFaults(kind: Kind, times: Times, baseline: Baseline, factor: number): string[] {
  const faults: [string, number][] = [];
  for (const [file, measured] of times) {
    const seconds = measured / factor;
    const allowed = Math.max(limitOf(kind) * NOISE, (baseline[file] ?? 0) * GROWTH);
    if (seconds > allowed)
      faults.push([
        `${file}: ${seconds.toFixed(1)} s, ${baseline[file] === undefined ? "the limit is" : "its baseline allows"} ${allowed.toFixed(0)} s`,
        seconds,
      ]);
  }
  return faults.sort((a, b) => b[1] - a[1]).map(([line]) => line);
}

/** Whether slow files fail the run: not in a release run (`untimed`), where the load of the machine decides the times; they are recorded there. */
export const slowFails = (faults: string[], untimed: boolean): boolean => faults.length > 0 && !untimed;

/** The baseline with each measured file at its time when still over the limit (never higher than before), and dropped when under it. A file not in it is added only when `adding`. */
export function lowered(kind: Kind, times: Times, baseline: Baseline, factor: number, adding = false): Baseline {
  const next: Baseline = { ...baseline };
  for (const [file, measured] of times) {
    const seconds = measured / factor;
    if (seconds <= limitOf(kind)) delete next[file];
    else if (file in baseline) next[file] = Math.round(Math.min(seconds, baseline[file] ?? seconds) * 10) / 10;
    else if (adding) next[file] = Math.round(seconds * 10) / 10;
  }
  return next;
}

export function writeSlowBaseline(root: string, baseline: Baseline): void {
  const sorted = Object.fromEntries(Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(root, BASELINE), `${JSON.stringify(sorted, null, 2)}\n`);
}

export interface StepTime {
  step: string;
  seconds: number;
  ok: boolean;
}

/** The steps as a table, slowest first. */
export function table(steps: StepTime[]): string {
  return [...steps]
    .sort((a, b) => b.seconds - a.seconds)
    .map((s) => `  ${s.step.padEnd(22)}${s.seconds.toFixed(1).padStart(7)} s${s.ok ? "" : "  FAILED"}`)
    .join("\n");
}

/** The fault of a run over its budget, naming the slowest steps; none on a busy machine. */
export function overBudget(steps: StepTime[], wall: number, factor: number): string | undefined {
  if (wall <= BUDGET_S || factor > 1) return undefined;
  const slowest = [...steps].sort((a, b) => b.seconds - a.seconds).slice(0, 3);
  return `the check took ${wall.toFixed(0)} s, over its budget of ${BUDGET_S} s; slowest: ${slowest.map((s) => `${s.step} ${s.seconds.toFixed(0)} s`).join(", ")}`;
}

const TIMES = "node_modules/.cache/test-times.json";

/** How long each test file took last time, to split the files into runs of equal time. */
export function readTimes(): Baseline {
  return existsSync(TIMES) ? (JSON.parse(readFileSync(TIMES, "utf8")) as Baseline) : {};
}

export function writeTimes(times: Times): void {
  mkdirSync("node_modules/.cache", { recursive: true });
  writeFileSync(TIMES, JSON.stringify({ ...readTimes(), ...Object.fromEntries(times) }));
}

/** The files split into `count` runs of about equal time: the last time of a file, or a guess from its size. */
export function split(files: string[], count: number, last: Baseline): string[][] {
  const weight = (f: string) => last[f.replace(/^\.\//, "")] ?? statSync(f).size / 4000;
  const runs: { files: string[]; weight: number }[] = Array.from({ length: count }, () => ({ files: [], weight: 0 }));
  for (const f of [...files].sort((a, b) => weight(b) - weight(a))) {
    const lightest = runs.reduce((a, b) => (b.weight < a.weight ? b : a));
    lightest.files.push(f);
    lightest.weight += weight(f);
  }
  return runs.map((r) => r.files);
}
