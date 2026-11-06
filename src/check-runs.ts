// Every run of a project's checks, in one log that `lineclear check` and the merge lane both append to. The log is the
// one record a check's cost, its catches and its flakes are counted from. A test that failed and then passed on the
// same commit is flaky: it is in quarantine from that run on, so it no longer blocks a merge, until 10 clean runs heal
// it or its fix releases it. A test that fails on every run is broken, not flaky, and blocks again.
// No imports beyond node: the server's merge lane uses this file too.
import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, writeSync } from "node:fs";
import { cpus, homedir, hostname, loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gitText } from "./git.ts";
import { DAY } from "./time.ts";

export interface FailedGate {
  step: string;
  line: string;
}

export type Tier = "inner" | "merge" | "heavy";

export interface CheckRun {
  kind: "run";
  /** when it ended, in ms */
  at: number;
  /** the project's main folder, the same for each of its worktrees */
  repo: string;
  /** the machine the check ran on (absent in older lines, which all ran on the main one) */
  machine?: string;
  tier: Tier;
  command: string;
  commit: string;
  branch: string;
  /** uncommitted edits: the run is not of its commit, so it proves no flake and no catch */
  dirty: boolean;
  seconds: number;
  /** the minutes it waited for its turn and a check slot before it started: 0 when it did not wait */
  slotWaitMin?: number;
  /** the one-minute load, the higher of its start and its end, and the machine's cores */
  load: number;
  /** the one-minute load when it started, alone: a slow run with a high one ran on a busy machine (absent in older lines) */
  loadAtStart?: number;
  cores: number;
  ok: boolean;
  /** the names of the tests that failed, as the runner printed them */
  failed: string[];
  /** a failed run that names no test: the first step that failed (a fast gate such as parts or gates) and the first line of its output */
  gate?: FailedGate;
  /** why a red run is red, never empty: `gate: <step>: <line>`, `test: <name>`, `timeout: <line>`, or `exit <code>: <last line>` when the output names nothing (absent in older lines) */
  causes?: string[];
  /** the failed tests of a run whose every failure is in a test the branch does not reach: not its doing, so each gets one Fix task (src/outside-fix.ts) */
  outside?: string[];
  /** it failed with no named test or gate and was run once more: not a refusal, whatever the rerun says */
  rerun?: boolean;
  /** it failed, but only on tests in quarantine, so it counted as passed */
  quarantined?: boolean;
  /** the runs of one tier run share it: a tier's budget is for their sum */
  group: string;
}

/** A quarantined test whose fix landed: it blocks merges again. */
interface Release {
  kind: "release";
  at: number;
  repo: string;
  test: string;
}

/** A tier that ran over its budget on an idle machine: a fault of the check, which the rule loop files a fix for. */
interface BudgetFault {
  kind: "budget";
  at: number;
  repo: string;
  tier: Tier;
  /** the tier's budget, in seconds */
  limitS: number;
  /** the time its commands took together, in seconds */
  seconds: number;
}

/** The fix task of a flaky test was filed: it is not filed again within a day. */
interface FixFiled {
  kind: "fix";
  at: number;
  repo: string;
  test: string;
}

/** The test files that passed in one check, each under its key (scripts/result-cache.ts): a later check with the same key does not run it again. */
interface Pass {
  kind: "pass";
  at: number;
  repo: string;
  keys: Record<string, string>;
}

type Entry = CheckRun | Release | BudgetFault | FixFiled | Pass;
type Env = Record<string, string | undefined>;

const configDir = (env: Env) => env.LINECLEAR_CONFIG ?? join(homedir(), ".config", "lineclear");
const logPath = (env: Env) => join(configDir(env), "check-runs.jsonl");

/** A name as a folder name. */
export const folderName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_");

/** The machine a check runs on: LINECLEAR_MACHINE, else the host name. */
export const machineOf = (env: Env = process.env) => folderName((env.LINECLEAR_MACHINE ?? "").split(".")[0] || hostname().split(".")[0] || "machine");

/** A project's folder as the log keys it: one name for it however a path reached it. */
const repoKey = (repo: string) => {
  try {
    return realpathSync(repo);
  } catch {
    return resolve(repo);
  }
};

// the log only grows, by one line per run: an append, not writeAtomic, so two runs at once both land
const append = (e: Entry, env: Env) => {
  mkdirSync(configDir(env), { recursive: true });
  const path = logPath(env);
  // a line a crash cut short gets its end, so the next entry is not glued onto it; only the last byte is read
  let cut = false;
  try {
    const fd = openSync(path, "r");
    try {
      const size = fstatSync(fd).size;
      const last = Buffer.alloc(1);
      cut = size > 0 && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 0x0a;
    } finally {
      closeSync(fd);
    }
  } catch {
    // no log yet
  }
  appendFileSync(path, `${cut ? "\n" : ""}${JSON.stringify(e)}\n`);
};

export const recordRun = (run: Omit<CheckRun, "kind">, env: Env = process.env) => append({ kind: "run", ...run, repo: repoKey(run.repo) }, env);

export const recordBudgetFault = (fault: Omit<BudgetFault, "kind">, env: Env = process.env) =>
  append({ kind: "budget", ...fault, repo: repoKey(fault.repo) }, env);

export const recordFixFiled = (repo: string, test: string, env: Env = process.env, now = Date.now()) =>
  append({ kind: "fix", at: now, repo: repoKey(repo), test }, env);

export const releaseTest = (repo: string, test: string, env: Env = process.env, now = Date.now()) =>
  append({ kind: "release", at: now, repo: repoKey(repo), test }, env);

export const recordPasses = (repo: string, keys: Record<string, string>, env: Env = process.env, now = Date.now()) => {
  if (Object.keys(keys).length > 0) append({ kind: "pass", at: now, repo: repoKey(repo), keys }, env);
};

/** The key each test file last passed under, from the pass lines of the log. */
export function readPasses(repo: string, env: Env = process.env): Record<string, string> {
  const key = repoKey(repo);
  const out: Record<string, string> = {};
  for (const e of entries(env)) if (e.kind === "pass" && e.repo === key) Object.assign(out, e.keys);
  return out;
}

/** The log, oldest first. A line cut short by a crash is skipped. */
function entries(env: Env): Entry[] {
  let text: string;
  try {
    text = readFileSync(logPath(env), "utf8");
  } catch {
    return [];
  }
  const out: Entry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as Entry;
      if (e?.kind === "run" || e?.kind === "release" || e?.kind === "budget" || e?.kind === "fix" || e?.kind === "pass") out.push(e);
    } catch {
      // a partial last line
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The runs of one project since a time (ms), oldest first. */
export const readRuns = (repo: string, since: number, env: Env = process.env): CheckRun[] =>
  entries(env).filter((e): e is CheckRun => e.kind === "run" && e.repo === repoKey(repo) && e.at >= since);

/** The last `count` runs of a project, one line each: short commit, time, slot wait and load at the start. */
export function runLog(repo: string, env: Env = process.env, count = 10): string[] {
  const runs = readRuns(repo, 0, env).slice(-count);
  if (runs.length === 0) return ["no check runs logged"];
  return runs.map(
    (r) =>
      `${r.commit.slice(0, 7)} ${new Date(r.at).toISOString().slice(0, 16)}Z ${r.seconds.toFixed(0)} s, waited ${(r.slotWaitMin ?? 0).toFixed(1)} min, load at start ${r.loadAtStart?.toFixed(1) ?? "?"}${r.rerun ? ", rerun" : ""}`,
  );
}

export interface Quarantined {
  test: string;
  command: string;
  commit: string;
  /** when the passing run proved it flaky */
  since: number;
  /** the times a failed run was followed by a pass on one commit, this flake included */
  flakes: number[];
  /** runs of the command since, in a row, that passed with the test not failing */
  clean: number;
  /** runs of the command since in which it failed again */
  failures: number;
  /** failures since its last clean run: 3 show it broken */
  streak: number;
}

/** Clean runs in a row that release a quarantined test by themselves. */
const HEAL_AFTER = 10;
/** Failures since the quarantine, with no clean run between, that show a test broken, not flaky. */
const BROKEN_AFTER = 3;

/** A test as the log names it (`<file>: <name>`, or the name alone where the output named no file): the key `scripts/flaky.ts` records by file and name. */
export const testKey = (file: string, name: string) => (file ? `${file}: ${name}` : name);

/** The file and name of a key; the file is empty where the key has none. */
export function splitKey(key: string): { file: string; test: string } {
  const m = /^(\S+\.(?:test|spec)\.\w+): (.+)$/.exec(key);
  return { file: m?.[1] ?? "", test: m?.[2] ?? key };
}

interface Scan {
  out: Map<string, Quarantined>;
  flakes: Map<string, number[]>;
  fixed: Map<string, number>;
}

function scan(repo: string, env: Env): Scan {
  const key = repoKey(repo);
  const out = new Map<string, Quarantined>();
  const flakes = new Map<string, number[]>();
  const fixed = new Map<string, number>();
  const broken = new Set<string>();
  const failedOn = new Map<string, CheckRun[]>();
  for (const e of entries(env)) {
    if (e.repo !== key || e.kind === "budget" || e.kind === "pass") continue;
    if (e.kind === "fix") {
      fixed.set(e.test, e.at);
      continue;
    }
    if (e.kind === "release") {
      out.delete(e.test);
      broken.delete(e.test);
      // a failure from before the fix proves nothing about the fixed test
      failedOn.clear();
      continue;
    }
    if (e.dirty) continue;
    const command = sameCommand(e.command);
    const passed = e.ok || e.quarantined === true;
    for (const t of broken) if (passed && !e.failed.includes(t)) broken.delete(t);
    for (const q of [...out.values()]) {
      if (sameCommand(q.command) !== command || e.at <= q.since) continue;
      if (e.failed.includes(q.test)) {
        q.failures++;
        q.streak++;
        q.clean = 0;
      } else if (passed) {
        q.clean++;
        q.streak = 0;
      }
      if (q.clean >= HEAL_AFTER) {
        out.delete(q.test);
        failedOn.clear();
      } else if (q.streak >= BROKEN_AFTER) {
        out.delete(q.test);
        broken.add(q.test);
        failedOn.clear();
      }
    }
    const at = `${command}\n${e.commit}`;
    if (!e.ok) {
      failedOn.set(at, [...(failedOn.get(at) ?? []), e]);
      continue;
    }
    // two failures before one pass are one flake
    const proven = new Set((failedOn.get(at) ?? []).flatMap((r) => r.failed));
    for (const test of proven) {
      if (broken.has(test)) continue;
      flakes.set(test, [...(flakes.get(test) ?? []), e.at]);
      const q = out.get(test);
      if (q) q.flakes = flakes.get(test) ?? [];
      else out.set(test, { test, command: e.command, commit: e.commit, since: e.at, flakes: flakes.get(test) ?? [], clean: 0, failures: 0, streak: 0 });
    }
    failedOn.delete(at);
  }
  return { out, flakes, fixed };
}

/**
 * The project's tests in quarantine now: each failed in a run that a later run of the same command passed on the same
 * commit. 10 clean runs of the command heal one; a test that fails 3 runs in a row after it is broken, and out.
 */
export const quarantined = (repo: string, env: Env = process.env): Map<string, Quarantined> => scan(repo, env).out;

/** The tests whose second flake in 24 hours has no fix task yet: each needs one. */
export function flakeFixDue(repo: string, env: Env = process.env, now = Date.now()): { test: string; seen: number }[] {
  const { flakes, fixed } = scan(repo, env);
  return [...flakes]
    .map(([test, times]) => ({ test, seen: times.filter((t) => now - t < DAY).length, filedAt: fixed.get(test) }))
    .filter((f) => f.seen >= 2 && (f.filedAt === undefined || now - f.filedAt >= DAY))
    .map(({ test, seen }) => ({ test, seen }));
}

/** One line for each test in quarantine with its run counts. */
export const quarantineReport = (repo: string, env: Env = process.env): string[] =>
  [...quarantined(repo, env).values()].map(
    (q) => `lineclear check: in quarantine: ${q.test} (${q.flakes.length} flakes, ${q.clean} of ${HEAL_AFTER} clean runs, ${q.failures} failed since)`,
  );

const NAMED_FAIL = [
  /^\s*\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/, // bun
  /^\s*not ok \d+ - (.+)$/, // TAP, node --test
  /^\s*[✖✘] (.+?)(?: \([\d.]+m?s\))?$/, // node's spec reporter, Playwright
];

/** bun prints the file of the tests below it on a line of its own. */
const FILE_HEADER = /^(\S+\.(?:test|spec)\.\w+):$/;

/** The tests a run's output names as failed, each once, as `<file>: <name>` where the output names the file. */
export function failedTests(output: string): string[] {
  const names = new Set<string>();
  let file: string | undefined;
  for (const line of output.split("\n")) {
    const header = FILE_HEADER.exec(line);
    if (header) file = header[1];
    for (const re of NAMED_FAIL) {
      const m = re.exec(line);
      if (m?.[1]) {
        names.add(testKey(file ?? "", m[1].trim()));
        break;
      }
    }
  }
  return [...names];
}

/** The first step of a check that failed and is not a test step, from the line scripts/check.ts prints for it: `check: <step> failed: <first line>`. */
export function failedGate(output: string): FailedGate | undefined {
  for (const line of output.split("\n")) {
    const m = /^check: (.+?) failed: (.+)$/.exec(line);
    if (m?.[1] && m[2]) return { step: m[1], line: m[2] };
  }
  return undefined;
}

/** Exit codes of a command killed for running too long: timeout(1), SIGKILL and SIGTERM. */
const TIMEOUT_CODES = new Set([124, 137, 143]);
// the check's own limits print these (scripts/check.ts, scripts/check-speed.ts); a bare word `timeout` would match a test's name
const TIMEOUT_LINE = /timed out|^check: .*(over its budget|too slow)/i;

/** What made a red run red, from its exit code and output: the failed gate, each failed test and a timeout. Never empty. */
export function failureCauses(output: string, code: number, failed: string[], gate: FailedGate | undefined): string[] {
  const lines = output.split("\n").filter((l) => l.trim() !== "");
  const causes = [...(gate ? [`gate: ${gate.step}: ${gate.line}`] : []), ...failed.map((t) => `test: ${t}`)];
  const slow = lines.find((l) => TIMEOUT_LINE.test(l));
  if (TIMEOUT_CODES.has(code) || slow) causes.push(`timeout: ${slow?.trim() ?? `exit ${code}`}`);
  return causes.length > 0 ? causes : [`exit ${code}: ${lines.at(-1)?.trim() ?? "no output"}`];
}

/** The red merge-tier runs by the first cause they name (`gate <step>`, `test`, `timeout`, `exit`; `unnamed` for a run logged before causes), and all merge-tier runs. */
export function redByCause(runs: CheckRun[]): { total: number; red: number; causes: [string, number][] } {
  const merge = runs.filter((r) => r.tier === "merge");
  const red = merge.filter((r) => !r.ok && !r.quarantined);
  const count = new Map<string, number>();
  for (const r of red) {
    // an older run has no causes: its failed tests and gate say as much
    const first = r.causes?.[0] ?? (r.gate ? `gate: ${r.gate.step}` : r.failed[0] ? "test" : undefined);
    const key = first === undefined ? "unnamed" : first.startsWith("gate: ") ? `gate ${first.slice(6).split(":")[0]}` : (first.split(/[: ]/)[0] ?? "unnamed");
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  return { total: merge.length, red: red.length, causes: [...count].sort((a, b) => b[1] - a[1]) };
}

/** Whether a red merge run is worth one more try: it names no test or gate, and the machine's load per core is under 1. */
export const worthRerun = (run: { failed: string[]; gate?: FailedGate; load: number; cores: number }): boolean =>
  run.failed.length === 0 && !run.gate && run.load / run.cores < 1;

/** The branches of the merge runs that refused a merge: a red run that was rerun is not one. */
export const refusedMergeBranches = (runs: CheckRun[]): string[] => runs.filter((r) => r.tier === "merge" && !r.ok && !r.rerun).map((r) => r.branch);

/** The tests scripts/check.ts printed as outside the change (`check: outside the change: <test>`). */
export const failedOutside = (output: string): string[] =>
  output.split("\n").flatMap((l) => (l.startsWith("check: outside the change: ") ? [l.slice("check: outside the change: ".length)] : []));

/** A runner's count of failed tests at the end of a run: bun, TAP and Playwright. */
const FAIL_COUNT = [/^\s*(\d+) fail$/gm, /^# fail (\d+)$/gm, /^\s*(\d+) failed$/gm];
/** Errors outside any test: a file that would not load, or an error no test caught. */
const LOOSE_ERROR = /^\s*[1-9]\d* errors?$|Unhandled error/m;

/** A command that is one test runner: its exit is the tests' own, with nothing after them left unrun. */
const BARE_RUNNER = /^(bunx? |npx |pnpm (exec )?)?(bun test|node --test|vitest run|jest|playwright test)\b/;
/** What a check that runs several steps prints once every step ran (scripts/check.ts), so a failure skipped none. */
export const EVERY_STEP_RAN = "check: every step ran";

/**
 * A failed run counts as passed when every test it names as failed is in quarantine and nothing else failed or went
 * unrun: one command, no chain; a bare test runner, or a check that printed that every step ran; it ended by itself
 * (exit code 1, not a timeout or a signal); the runner's count of failures was printed and matches; no error fell
 * outside a test; and the check's only other complaint is a tests step that failed.
 */
export function onlyQuarantined(command: string, output: string, code: number, failed: string[], inQuarantine: Map<string, unknown>): boolean {
  if (code !== 1 || failed.length === 0 || !failed.every((t) => inQuarantine.has(t))) return false;
  if (/&&|\|\||;|\|/.test(command)) return false;
  const lines = output.split("\n");
  if (!BARE_RUNNER.test(command.trim()) && !lines.includes(EVERY_STEP_RAN)) return false;
  const counts = FAIL_COUNT.flatMap((re) => [...output.matchAll(re)].map((m) => Number(m[1])));
  if (counts.length === 0 || counts.reduce((n, c) => n + c, 0) !== failed.length) return false;
  if (LOOSE_ERROR.test(output)) return false;
  return lines
    .filter((l) => l.startsWith("check: "))
    .every(
      (l) =>
        l === EVERY_STEP_RAN ||
        l === "check: failing tests:" ||
        /^check: [\w ]*tests( \d+\/\d+)? failed$/.test(l) ||
        /^check( --full| --changed)?: steps, slowest first /.test(l),
    );
}

/** One command however it was spaced, so its runs are counted together. */
export const sameCommand = (c: string) => c.trim().replace(/\s+/g, " ");

/** The project's main folder (for a worktree, the one that holds its .git), this machine, its commit, branch and whether it has edits. */
export function whereRun(cwd: string, env: Env = process.env): { repo: string; machine: string; commit: string; branch: string; dirty: boolean } {
  const common = gitText(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return {
    repo: common ? dirname(common) : resolve(cwd),
    machine: machineOf(env),
    commit: gitText(cwd, "rev-parse", "HEAD") ?? "",
    branch: gitText(cwd, "rev-parse", "--abbrev-ref", "HEAD") ?? "",
    dirty: (gitText(cwd, "status", "--porcelain") ?? "") !== "",
  };
}

/**
 * The load to record with a run: call at its start, and call what it returns at its end. The 5-minute average counts too:
 * the 1-minute one lags a machine that got busy while the run went on.
 */
export function loadMeter(read: () => number[] = loadavg): () => { load: number; loadAtStart: number; cores: number } {
  const start = read()[0] ?? 0;
  return () => {
    const [now = 0, recent = 0] = read();
    return { load: Math.max(start, now, recent), loadAtStart: start, cores: cpus().length };
  };
}

const STEP_LOG_LINES = 5000;

/** One line per step of a check in the steps log beside the check log: what each check spent its time on. Keeps the newest 5000. */
export function recordStepTimes(lines: object[], env: Env = process.env): void {
  mkdirSync(configDir(env), { recursive: true });
  const file = join(configDir(env), "check-steps.jsonl");
  appendFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  const all = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l !== "");
  if (all.length > STEP_LOG_LINES) replaceWhole(file, `${all.slice(-STEP_LOG_LINES).join("\n")}\n`);
}

/** The trimmed log is written beside the old one and renamed over it, so a cut never leaves half a log. */
function replaceWhole(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
}
