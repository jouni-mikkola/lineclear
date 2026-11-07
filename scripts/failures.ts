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

/** How a failure is listed: `<file> > <test>: <first error line>`, the release's held line and the check's own output alike. */
export const describeFailure = (f: Failure): string => `${f.file ? `${f.file} > ` : ""}${f.test}: ${f.error ?? "no error line"}`;

export const QUARANTINE_MAX = 5;
export interface Quarantined {
  test: string;
  /** the task that fixes the flake */
  task: string;
}

/** A failure's name in the quarantine: `<prefix><file> > <test>`; the prefix is the folder a step runs in, for the server's tests. */
export const quarantineKey = (f: Failure, prefix = ""): string => `${prefix}${f.file.replace(/^\.\//, "")} > ${f.test}`;

/**
 * Judges a test step's failures after each was run again alone (`failsAlone`). A failure that passes alone is a flake: in quarantine it
 * is let through, new it joins the quarantine (up to QUARANTINE_MAX) and is let through. One that fails alone too, or a flake with no
 * room left, fails the check.
 */
export function judgeFailures(
  failures: Failure[],
  failsAlone: (f: Failure) => boolean,
  quarantine: Quarantined[],
  task: string,
  prefix = "",
): { ok: boolean; quarantine: Quarantined[]; flaky: string[]; broken: string[] } {
  const next = [...quarantine];
  const flaky: string[] = [];
  const broken: string[] = [];
  for (const f of failures) {
    const key = quarantineKey(f, prefix);
    if (failsAlone(f)) broken.push(key);
    else if (next.some((q) => q.test === key)) flaky.push(key);
    else if (next.length < QUARANTINE_MAX) {
      next.push({ test: key, task });
      flaky.push(key);
    } else broken.push(`${key} (a flake, but the quarantine holds ${QUARANTINE_MAX} already)`);
  }
  return { ok: broken.length === 0, quarantine: next, flaky, broken };
}
