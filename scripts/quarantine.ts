// Flaky tests: a failure is run again alone. One that passes alone is a flake and goes to test/quarantine.json with its fix task.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Failure } from "./failures.ts";

export const QUARANTINE_FILE = "test/quarantine.json";
export const QUARANTINE_MAX = 5;

export interface Quarantined {
  file: string;
  test: string;
  /** The task that fixes the flake; the test leaves quarantine once it is fixed. */
  task: string;
}

export const readQuarantine = (path = QUARANTINE_FILE): Quarantined[] => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Quarantined[]) : []);

export const writeQuarantine = (list: Quarantined[], path = QUARANTINE_FILE): void => writeFileSync(path, `${JSON.stringify(list, null, 2)}\n`);

export interface Verdict {
  /** Failures that still fail the check: broken alone, or a flake with no room in quarantine. */
  blocking: Failure[];
  /** Flaky failures that no longer fail the check. */
  tolerated: Failure[];
  /** The quarantine after this run. */
  quarantine: Quarantined[];
}

/** `passesAlone` runs one test by itself. A failure that passes alone is tolerated and quarantined; one that fails alone blocks. */
export async function judge(failures: Failure[], quarantine: Quarantined[], task: string, passesAlone: (f: Failure) => Promise<boolean>): Promise<Verdict> {
  const next = [...quarantine];
  const blocking: Failure[] = [];
  const tolerated: Failure[] = [];
  for (const f of failures) {
    if (!(await passesAlone(f))) {
      blocking.push(f);
      continue;
    }
    if (!next.some((q) => q.file === f.file && q.test === f.test)) {
      if (next.length >= QUARANTINE_MAX) {
        blocking.push(f);
        continue;
      }
      next.push({ file: f.file, test: f.test, task });
    }
    tolerated.push(f);
  }
  return { blocking, tolerated, quarantine: next };
}
