// Flaky tests: a failure that passes when run alone is a flake. A flake in test/quarantine.json no longer fails the check.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Failure } from "./failures.ts";

export const MAX_QUARANTINED = 5;
export const QUARANTINE_FILE = "test/quarantine.json";

export interface Quarantined {
  /** `<folder>/<file> > <test name>`, the folder being `.` for the root's tests and `server` for the server's. */
  test: string;
  /** The id of the task that fixes it. */
  fix: string;
}

export const quarantineKey = (folder: string, f: Failure): string => `${folder}/${f.file.replace(/^\.\//, "")} > ${f.test}`;

export const readQuarantine = (path = QUARANTINE_FILE): Quarantined[] => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Quarantined[]) : []);

export const writeQuarantine = (list: Quarantined[], path = QUARANTINE_FILE): void => writeFileSync(path, `${JSON.stringify(list, null, 2)}\n`);

export interface Verdict {
  /** Failed alone too, or flaked with the quarantine full: these fail the check. */
  broken: Failure[];
  /** Flaked and already in quarantine. */
  tolerated: Failure[];
  /** Flaked and now added to quarantine. */
  added: Failure[];
}

/** Sorts a step's failures by `passesAlone`: a failure alone always breaks; a flake is tolerated while the quarantine has room for it. */
export function judge(folder: string, failures: Failure[], passesAlone: (f: Failure) => boolean, quarantined: Quarantined[], max = MAX_QUARANTINED): Verdict {
  const known = new Set(quarantined.map((q) => q.test));
  const verdict: Verdict = { broken: [], tolerated: [], added: [] };
  let size = known.size;
  for (const f of failures) {
    if (!passesAlone(f)) verdict.broken.push(f);
    else if (known.has(quarantineKey(folder, f))) verdict.tolerated.push(f);
    else if (size < max) {
      size++;
      verdict.added.push(f);
    } else verdict.broken.push(f);
  }
  return verdict;
}
