// Reads the failures a `bun test` step printed, for the check's own output and its outside-the-change test.
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

/** A test known to flake: it failed and then passed alone on one commit. `task` is the task that fixes it. */
export interface Quarantined {
  file: string;
  test: string;
  task: string;
}

export const MAX_QUARANTINE = 5;

const sameTest = (q: Quarantined, f: Failure) => q.file.replace(/^\.\//, "") === f.file.replace(/^\.\//, "") && q.test === f.test;

/** Reads `test/quarantine.json`: a list of `{file, test, task}`, server files named `server/<file>`. */
export function readQuarantine(path: string): Quarantined[] {
  const list: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(list)) throw new Error(`${path} must be a list`);
  return list.map((q) => {
    if (typeof q?.file !== "string" || typeof q.test !== "string" || typeof q.task !== "string" || q.task === "") {
      throw new Error(`${path}: every entry needs a file, a test and the id of its fix task`);
    }
    return { file: q.file, test: q.test, task: q.task };
  });
}

export interface Verdict {
  /** failed alone too: the check fails */
  broken: Failure[];
  /** failed, then passed alone, and is in quarantine: not counted */
  quarantined: Failure[];
  /** failed, then passed alone, and is not in quarantine: it must be added with its fix task, and the check fails until then */
  unlisted: Failure[];
  /** the list is over its limit, or a new flake has no room in it */
  full: boolean;
}

/** Sorts a step's failures by what the rerun alone showed (`failedAlone`: the ones that failed again). */
export function judgeFailures(failures: Failure[], failedAlone: Failure[], quarantine: Quarantined[]): Verdict {
  const broken = failures.filter((f) => failedAlone.includes(f));
  const flaky = failures.filter((f) => !failedAlone.includes(f));
  const quarantined = flaky.filter((f) => quarantine.some((q) => sameTest(q, f)));
  const unlisted = flaky.filter((f) => !quarantined.includes(f));
  return {
    broken,
    quarantined,
    unlisted,
    full: quarantine.length > MAX_QUARANTINE || (unlisted.length > 0 && quarantine.length + unlisted.length > MAX_QUARANTINE),
  };
}

/** Whether a step with these failures passes: nothing broke alone, and every flake is listed with room to spare. */
export const passes = (v: Verdict): boolean => v.broken.length === 0 && v.unlisted.length === 0 && !v.full;

/** The command that runs one failed test alone: its file, filtered to its name (the last part of a `describe > test` name). */
export function aloneCommand(f: Failure): string[] {
  const name = f.test.split(" > ").at(-1) ?? f.test;
  return ["bun", "test", "--timeout", "120000", f.file.startsWith(".") ? f.file : `./${f.file}`, "-t", `${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`];
}
