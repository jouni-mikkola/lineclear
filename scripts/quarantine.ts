// Flaky tests: a test that fails in the run and then passes alone on the same commit is listed in test/quarantine.json
// with the id of the task that fixes it. A quarantined test's failure alone does not fail the check.
//   bun scripts/quarantine.ts add <file> <test> <task>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Failure } from "./failures.ts";

export interface Quarantined {
  /** repo path of the test file, `server/test/x.test.ts` for the server's */
  file: string;
  test: string;
  /** the task that fixes the flake */
  task: string;
}

export const QUARANTINE_FILE = "test/quarantine.json";
export const QUARANTINE_LIMIT = 5;

export function readQuarantine(path = QUARANTINE_FILE): Quarantined[] {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Quarantined[]) : [];
}

/** The key of a failure: the repo path of its file and its name. `prefix` is the folder the step ran in. */
export const failureKey = (f: Failure, prefix = ""): string => `${prefix}${f.file.replace(/^\.\//, "")}\0${f.test}`;

export interface Verdict {
  /** failed in the run, passed alone, and in quarantine: does not fail the check */
  tolerated: Failure[];
  /** failed in the run and passed alone, not in quarantine: fails the check until it is listed */
  flaky: Failure[];
  /** failed alone too: always fails the check */
  broken: Failure[];
}

/** Sorts a run's failures by what the rerun alone showed. `passedAlone` holds the keys of the ones that passed. */
export function judge(failures: Failure[], passedAlone: Set<string>, quarantine: Quarantined[], prefix = ""): Verdict {
  const listed = new Set(quarantine.map((q) => `${q.file}\0${q.test}`));
  const verdict: Verdict = { tolerated: [], flaky: [], broken: [] };
  for (const f of failures) {
    const key = failureKey(f, prefix);
    if (!passedAlone.has(key)) verdict.broken.push(f);
    else if (listed.has(key)) verdict.tolerated.push(f);
    else verdict.flaky.push(f);
  }
  return verdict;
}

/** The list with one more flake; refused at the limit, so a sixth flake is fixed before another is parked. */
export function withFlake(list: Quarantined[], flake: Quarantined): Quarantined[] {
  if (list.some((q) => q.file === flake.file && q.test === flake.test)) return list;
  if (!/^[A-Z]+-\d+$/.test(flake.task)) throw new Error(`quarantine needs the id of the fix task, got "${flake.task}"`);
  if (list.length >= QUARANTINE_LIMIT) throw new Error(`quarantine holds ${QUARANTINE_LIMIT} tests already: fix one before adding another`);
  return [...list, flake];
}

if (import.meta.main) {
  const [verb, file, test, task] = process.argv.slice(2);
  if (verb !== "add" || !file || !test || !task) {
    console.error("usage: bun scripts/quarantine.ts add <file> <test> <task>");
    process.exit(2);
  }
  writeFileSync(QUARANTINE_FILE, `${JSON.stringify(withFlake(readQuarantine(), { file, test, task }), null, 2)}\n`);
}
