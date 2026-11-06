// A test that fails in the check and passes when run again alone is a flake, not a broken change: it is recorded, and the
// check goes on. A test that fails again alone fails the check. A flake seen twice in a day files its own fix task.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { flakeFixIn } from "../src/check-tier.ts";
import { decisionsPath, realWorld } from "../src/rules.ts";
import { findProject } from "../src/waits.ts";
import { testKey } from "../src/check-runs.ts";
import { readSettings } from "../src/project.ts";

export interface Failure {
  file: string;
  test: string;
  /** The first line of the failure's error, or `timed out after <n>ms` when the runner stopped it for its time limit. */
  error?: string;
}

/** The stall class a flake is recorded under in decisions.jsonl. */
export const FLAKY_CLASS = "flaky test";
const DAY_MS = 24 * 3_600_000;

/** What `bun test` prints: a `<file>:` line before each file's results, then `(fail) <name> [<ms>]` for each failure. */
export function parseFailures(output: string): Failure[] {
  const found: Failure[] = [];
  let file = "";
  let error: string | undefined;
  for (const line of output.split("\n")) {
    const head = /^(\S+\.test\.ts):$/.exec(line);
    // the summary at the end repeats each failure without its file
    if (/^\d+ tests? failed:$/.test(line)) break;
    const timeout = /^\s*\^ this test timed out after (\d+)ms/.exec(line);
    if (head) file = head[1] ?? "";
    else if (line.startsWith("error: ")) error = line.slice(7).trim();
    else if (timeout) {
      const last = found[found.length - 1];
      if (last) last.error = `timed out after ${timeout[1]}ms`;
    } else if (line.startsWith("(fail) ")) {
      found.push({ file, test: line.slice(7).replace(/ \[[\d.]+ms\]$/, ""), ...(error ? { error } : {}) });
      error = undefined;
    }
  }
  return found.filter((f, i) => found.findIndex((g) => g.file === f.file && g.test === f.test) === i);
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Runs one failed test alone. True when it passes. A test in a describe block prints as `group > name`, which `-t` matches as `group name`. */
export function passesAlone(f: Failure, env: Record<string, string | undefined>, cwd = "."): boolean {
  if (f.file === "") return false;
  const p = Bun.spawnSync(["bun", "test", "--timeout", "120000", `./${f.file}`, "-t", escapeRegex(f.test.replaceAll(" > ", " "))], {
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return p.exitCode === 0 && /^\(pass\) /m.test(p.stdout.toString() + p.stderr.toString());
}

type FlakeRecord = { time: string; project: string; kind: "stall"; reason: string; class: string; file: string; test: string; filed?: true };

function readRecords(path: string): FlakeRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .flatMap((l) => {
      try {
        return l.trim() ? [JSON.parse(l) as FlakeRecord] : [];
      } catch {
        return [];
      }
    });
}

/**
 * The hook for a fix task: gets the flaky test and its evidence, files the task. The default adds a task to the
 * project's Lineclear space; a learning loop that files its own tasks replaces it. True when the task is filed.
 */
export type FileFix = (f: Failure, seen: number) => boolean;

export const fileFixTask: FileFix = (f, seen) => {
  const project = findProject(".");
  const settings = project === undefined ? undefined : readSettings(project);
  return settings !== undefined && typeof settings !== "string" && flakeFixIn(realWorld())(settings.space, f, seen);
};

/** Records a flake in decisions.jsonl; the second of the same test in 24 hours files its fix task, once. */
export function recordFlake(f: Failure, env: NodeJS.ProcessEnv = process.env, now = new Date(), file: FileFix = fileFixTask): void {
  const path = decisionsPath(env);
  const same = readRecords(path).filter(
    (r) => r.class === FLAKY_CLASS && r.file === f.file && r.test === f.test && now.getTime() - Date.parse(r.time) < DAY_MS,
  );
  const due = same.length >= 1 && !same.some((r) => r.filed);
  const filed = due && file(f, same.length + 1);
  const record: FlakeRecord = {
    time: now.toISOString(),
    project: findProject(".", env) ?? "-",
    kind: "stall",
    reason: `${f.test} failed in the check and passed alone`,
    class: FLAKY_CLASS,
    file: f.file,
    test: f.test,
    ...(filed ? { filed: true as const } : {}),
  };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

/** Settles the failures of a test step: true when every one passes alone (each is recorded), false when one fails again. */
export function settleFailures(failures: Failure[], env: NodeJS.ProcessEnv, again = passesAlone, record = recordFlake): boolean {
  if (failures.length === 0) return false;
  const flaky: Failure[] = [];
  for (const f of failures) {
    if (!again(f, env)) return false;
    flaky.push(f);
  }
  for (const f of flaky) {
    console.error(`check: flaky test, passed alone: ${testKey(f.file, f.test)}`);
    record(f);
  }
  return true;
}

/** True when every failure is in a test file the branch did not change and its code does not reach (`touched`): it fails for the load, not the change. */
export const outsideChange = (failures: Failure[], touched: Set<string>): boolean =>
  failures.length > 0 && failures.every((f) => f.file !== "" && !touched.has(f.file.replace(/^\.\//, "")));

/** How a failure is listed: `<file> > <test>: <first error line>`, the release's held line and the check's own output alike. */
export const describeFailure = (f: Failure): string => `${f.file ? `${f.file} > ` : ""}${f.test}: ${f.error ?? "no error line"}`;
