// Reads the failures a `bun test` step printed, for the check's own output and its outside-the-change test.

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

export interface Quarantined {
  file: string;
  test: string;
  /** The task that fixes the flake; the test leaves quarantine once it is fixed. */
  task: string;
}

export const QUARANTINE_LIMIT = 5;

const sameTest = (a: { file: string; test: string }, b: { file: string; test: string }): boolean =>
  a.test === b.test && a.file.replace(/^\.\//, "") === b.file.replace(/^\.\//, "");

export interface Settled {
  /** Failures that also fail alone, or flake with no room left in quarantine. */
  fatal: Failure[];
  /** Failures of tests already in quarantine: they do not fail the check. */
  quarantined: Failure[];
  /** New flakes that failed and then passed alone: added to the quarantine. */
  added: Quarantined[];
}

/** Reruns each failure alone. A quarantined test's failure is let through, a new flake is quarantined while there is room, the rest fail. */
export async function settleFailures(
  failures: Failure[],
  quarantine: Quarantined[],
  passesAlone: (f: Failure) => Promise<boolean>,
  fixTask = "unfiled",
): Promise<Settled> {
  const settled: Settled = { fatal: [], quarantined: [], added: [] };
  for (const f of failures) {
    if (quarantine.some((q) => sameTest(q, f))) {
      settled.quarantined.push(f);
    } else if (!(await passesAlone(f))) {
      settled.fatal.push(f);
    } else if (quarantine.length + settled.added.length < QUARANTINE_LIMIT) {
      settled.added.push({ file: f.file, test: f.test, task: fixTask });
    } else {
      settled.fatal.push(f);
    }
  }
  return settled;
}

/** How a failure is listed: `<file> > <test>: <first error line>`, the release's held line and the check's own output alike. */
export const describeFailure = (f: Failure): string => `${f.file ? `${f.file} > ` : ""}${f.test}: ${f.error ?? "no error line"}`;
