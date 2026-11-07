// Flaky tests: a failure that passes when run alone is a flake. A quarantined flake no longer fails the check; a failure alone still does.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Failure } from "./failures.ts";

export const QUARANTINE_FILE = "test/quarantine.json";
export const QUARANTINE_MAX = 5;

/** `test` is `<file>: <name>`, as src/check-runs.ts names a failed test; `task` is the task that fixes it. */
export interface Quarantined {
  test: string;
  task: string;
}

export const testKey = (f: Failure, prefix = ""): string => `${prefix}${f.file.replace(/^\.\//, "")}: ${f.test}`;

export function readQuarantine(path = QUARANTINE_FILE): Quarantined[] {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Quarantined[]) : [];
}

/** The list with `test` added; refused when it is full, so a sixth flake gets fixed instead of hidden. */
export function withQuarantined(list: Quarantined[], test: string, task: string): Quarantined[] {
  if (list.some((q) => q.test === test)) return list;
  if (list.length >= QUARANTINE_MAX) throw new Error(`quarantine is full (${QUARANTINE_MAX} tests): fix one before quarantining ${test}`);
  return [...list, { test, task }];
}

export const saveQuarantine = (list: Quarantined[], path = QUARANTINE_FILE): void => writeFileSync(path, `${JSON.stringify(list, null, 2)}\n`);

export interface Verdict {
  /** failed, passed alone, and in quarantine: not held against the check */
  quarantined: string[];
  /** failed, passed alone, not in quarantine: a new flake that needs a fix task and a place in quarantine */
  flaky: string[];
  /** failed alone too: a break */
  broken: string[];
}

/** Sorts a step's failures by running each alone with `passesAlone`. The step passes when only quarantined flakes are left. */
export async function judge(
  failures: Failure[],
  passesAlone: (f: Failure) => Promise<boolean>,
  list: Quarantined[],
  prefix = "",
): Promise<Verdict & { ok: boolean }> {
  const verdict: Verdict = { quarantined: [], flaky: [], broken: [] };
  const known = new Set(list.map((q) => q.test));
  for (const f of failures) {
    const key = testKey(f, prefix);
    if (!(await passesAlone(f))) verdict.broken.push(key);
    else if (known.has(key)) verdict.quarantined.push(key);
    else verdict.flaky.push(key);
  }
  return { ...verdict, ok: failures.length > 0 && verdict.broken.length === 0 && verdict.flaky.length === 0 };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Runs one failed test alone: its file, filtered to its name. */
export async function runAlone(f: Failure, cwd: string | undefined, env: Record<string, string | undefined>): Promise<boolean> {
  if (f.file === "") return false;
  const p = Bun.spawn(["bun", "test", "--timeout", "120000", f.file, "-t", `^${escapeRegExp(f.test)}$`], {
    cwd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: { ...env, LINECLEAR_TEST_RUNNER: "1" },
  });
  return (await p.exited) === 0;
}
