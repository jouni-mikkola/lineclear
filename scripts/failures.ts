// Reads the failures a `bun test` step printed, for the check's own output and its outside-the-change test,
// and sorts them into broken tests and quarantined flakes.
import { readFileSync } from "node:fs";

export interface Failure {
  file: string;
  test: string;
  /** The first line of the failure's error, or `timed out after <n>ms` when the runner stopped it for its time limit. */
  error?: string;
}

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

/** True when every failure is in a test file the branch did not change and its code does not reach (`touched`): it fails for the load, not the change. */
export const outsideChange = (failures: Failure[], touched: Set<string>): boolean =>
  failures.length > 0 && failures.every((f) => f.file !== "" && !touched.has(f.file.replace(/^\.\//, "")));

/** How a failure is listed: `<file> > <test>: <first error line>`, the release's held line and the check's own output alike. */
export const describeFailure = (f: Failure): string => `${f.file ? `${f.file} > ` : ""}${f.test}: ${f.error ?? "no error line"}`;

/** A flaky test: it failed in a run and passed alone. `fix` is the task that repairs it; the test leaves quarantine once that is merged. */
export interface Quarantined {
  /** repo-relative, so a root test and a server test never share a name */
  file: string;
  test: string;
  fix: string;
}

/** More flakes than this hold the check: the tests are rotting faster than they are fixed. */
export const QUARANTINE_MAX = 5;

export function readQuarantine(path: string): Quarantined[] {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Quarantined[];
  } catch {
    return [];
  }
}

export interface Settled {
  /** failed alone too, or a flake the full quarantine has no room for: these fail the check */
  broken: Failure[];
  /** passed alone and is in quarantine, or was just put there */
  flaky: Failure[];
  added: Quarantined[];
}

/**
 * Sorts a step's failures. `file` is the failure's repo-relative file and `alone` reruns one test by itself.
 * A test that fails alone is broken. One that passes alone is a flake: quarantined with `fix`, unless 5 already are.
 */
export async function settle(
  failures: Failure[],
  file: (f: Failure) => string,
  alone: (f: Failure) => Promise<boolean>,
  quarantine: Quarantined[],
  fix: string,
): Promise<Settled> {
  const result: Settled = { broken: [], flaky: [], added: [] };
  const held = [...quarantine];
  for (const f of failures) {
    if (!(await alone(f))) result.broken.push(f);
    else if (held.some((q) => q.file === file(f) && q.test === f.test)) result.flaky.push(f);
    else if (held.length < QUARANTINE_MAX) {
      const entry = { file: file(f), test: f.test, fix };
      held.push(entry);
      result.added.push(entry);
      result.flaky.push(f);
    } else result.broken.push(f);
  }
  return result;
}
