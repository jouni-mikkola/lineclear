// Flaky tests: a test that fails in a run and passes alone is quarantined, so its failure no longer holds the merge.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Failure } from "./failures.ts";

export interface Quarantined {
  file: string;
  test: string;
  /** the task that fixes the test; a test leaves quarantine only once it is fixed */
  task: string;
}

export const QUARANTINE_FILE = "test/quarantine.json";
export const QUARANTINE_MAX = 5;
/** Written for a flake the check found itself: the board files its fix task and puts that id here. */
export const UNFILED = "unfiled";

const same = (a: { file: string; test: string }, b: { file: string; test: string }): boolean =>
  a.test === b.test && a.file.replace(/^\.\//, "") === b.file.replace(/^\.\//, "");

export const readQuarantine = (path = QUARANTINE_FILE): Quarantined[] => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Quarantined[]) : []);

export const writeQuarantine = (list: Quarantined[], path = QUARANTINE_FILE): void => writeFileSync(path, `${JSON.stringify(list, null, 2)}\n`);

export interface Verdict {
  /** failures that passed alone and are in quarantine (now or already): they do not fail the check */
  quarantined: Failure[];
  /** the quarantine after this run */
  list: Quarantined[];
  /** failures that fail the check: they failed alone too, or the quarantine is full */
  blocking: Failure[];
}

/** Sorts the failures of a step: `passesAlone` reruns one test on its own. A quarantined test is not rerun. */
export async function judge(failures: Failure[], quarantine: Quarantined[], passesAlone: (f: Failure) => Promise<boolean>): Promise<Verdict> {
  const list = [...quarantine];
  const quarantined: Failure[] = [];
  const blocking: Failure[] = [];
  for (const f of failures) {
    if (list.some((q) => same(q, f))) quarantined.push(f);
    else if (!(await passesAlone(f))) blocking.push(f);
    else if (list.length >= QUARANTINE_MAX) blocking.push(f);
    else {
      list.push({ file: f.file.replace(/^\.\//, ""), test: f.test, task: UNFILED });
      quarantined.push(f);
    }
  }
  return { quarantined, list, blocking };
}
