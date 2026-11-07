import { existsSync, readFileSync, writeFileSync } from "node:fs";

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

/** A flaky test taken out of the check's way until its fix task lands. */
export interface Quarantined {
  file: string;
  test: string;
  /** The id of the task that fixes it; `unfiled` until one is filed. */
  fix: string;
}

export const QUARANTINE_MAX = 5;

const key = (f: { file: string; test: string }) => `${f.file.replace(/^\.\//, "")} > ${f.test}`;

/** What the failures of a test step come to once each was run alone. */
export interface Verdict {
  /** failed alone too, or was never rerun: still fails the check */
  broken: Failure[];
  /** failed and then passed alone, and already in quarantine */
  quarantined: Failure[];
  /** failed and then passed alone, not in quarantine yet: goes in with its fix task */
  flaky: Failure[];
  /** the quarantine after this run, or the reason it cannot take the new flakes */
  next: Quarantined[];
  error?: string;
}

/** Reruns each failure alone (`passesAlone`). Only a failure that then passes can be quarantined; the quarantine holds at most QUARANTINE_MAX. */
export function judge(failures: Failure[], quarantine: Quarantined[], passesAlone: (f: Failure) => boolean): Verdict {
  const held = new Set(quarantine.map(key));
  const broken: Failure[] = [];
  const quarantined: Failure[] = [];
  const flaky: Failure[] = [];
  for (const f of failures) {
    if (!passesAlone(f)) broken.push(f);
    else if (held.has(key(f))) quarantined.push(f);
    else flaky.push(f);
  }
  const next = [...quarantine, ...flaky.map((f) => ({ file: f.file.replace(/^\.\//, ""), test: f.test, fix: "unfiled" }))];
  if (next.length > QUARANTINE_MAX) {
    return {
      broken: [...broken, ...flaky],
      quarantined,
      flaky: [],
      next: quarantine,
      error: `quarantine is full (${QUARANTINE_MAX} tests): fix a flaky test first`,
    };
  }
  return { broken, quarantined, flaky, next };
}

/** `bun test` prints `<n> fail`: a step that failed for another reason than its listed tests has more or fewer. */
export const failCount = (output: string): number | undefined => {
  const m = /^\s*(\d+) fail$/m.exec(output);
  return m ? Number(m[1]) : undefined;
};

export function readQuarantine(path: string): Quarantined[] {
  // a missing file is an empty quarantine, a damaged one is an error: writing over it would lose the tests it holds
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Quarantined[]) : [];
}

export const writeQuarantine = (path: string, list: Quarantined[]): void => writeFileSync(path, `${JSON.stringify(list, null, 2)}\n`);
