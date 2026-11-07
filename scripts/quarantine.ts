// Flaky tests: a failed test is rerun alone. Failing alone too is a real failure. Passing alone is a flake, and only a
// flake in test/quarantine.json (with the task that fixes it) is let through.
import { existsSync, readFileSync } from "node:fs";
import type { Failure } from "./failures.ts";

export const QUARANTINE_FILE = "test/quarantine.json";
export const QUARANTINE_LIMIT = 5;

export interface Quarantined {
  /** the test file as `bun test` prints it, from the folder the step runs in */
  file: string;
  test: string;
  /** the task that fixes the flake */
  task: string;
}

export function readQuarantine(root = "."): Quarantined[] {
  const path = `${root}/${QUARANTINE_FILE}`;
  const list: Quarantined[] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  if (list.length > QUARANTINE_LIMIT) throw new Error(`${QUARANTINE_FILE} holds ${list.length} tests, at most ${QUARANTINE_LIMIT}: fix one first`);
  return list;
}

const key = (f: { file: string; test: string }) => `${f.file.replace(/^\.\//, "")} > ${f.test}`;

/** The `bun test` arguments that run one failed test alone: its file and its name as a pattern. */
export function aloneArgs(f: Failure): string[] {
  const pattern = f.test
    .split(" > ")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return ["test", "--timeout", "120000", ...(f.file ? [f.file.startsWith(".") ? f.file : `./${f.file}`] : []), "-t", pattern];
}

export interface Verdict {
  /** failed alone too, or flaked with no room left in quarantine: the check fails */
  real: Failure[];
  /** flaked and quarantined: let through */
  quarantined: Failure[];
  /** flaked and not yet listed, with room for it: let through this once, to be listed with its fix task */
  unlisted: Failure[];
}

/** Sorts a step's failures by whether each passed when rerun alone and whether it is in quarantine. */
export function judge(failures: Failure[], passedAlone: (f: Failure) => boolean, list: Quarantined[]): Verdict {
  const listed = new Set(list.map(key));
  const verdict: Verdict = { real: [], quarantined: [], unlisted: [] };
  for (const f of failures) {
    if (!passedAlone(f)) verdict.real.push(f);
    else if (listed.has(key(f))) verdict.quarantined.push(f);
    else if (list.length + verdict.unlisted.length < QUARANTINE_LIMIT) verdict.unlisted.push(f);
    else verdict.real.push(f);
  }
  return verdict;
}

/** The list with new flakes added under a fix task; refuses to pass the limit. */
export function quarantineWith(list: Quarantined[], flakes: Failure[], task: string): Quarantined[] {
  const next = [...list];
  for (const f of flakes) if (!next.some((q) => key(q) === key(f))) next.push({ file: f.file.replace(/^\.\//, ""), test: f.test, task });
  if (next.length > QUARANTINE_LIMIT) throw new Error(`quarantine holds at most ${QUARANTINE_LIMIT} tests: fix one first`);
  return next;
}
