// Flaky tests: a failure that passes when run alone is a flake. A listed one no longer fails the check, an unlisted one
// is listed in test/quarantine.json (up to the cap) and a failure alone too always fails.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Failure } from "./failures.ts";

export interface Quarantined {
  /** the test file as the repo root names it, `server/test/x.test.ts` for the server's */
  file: string;
  test: string;
  /** the task that fixes it; `unfiled` until one is */
  task: string;
}

export const QUARANTINE_FILE = "test/quarantine.json";
export const QUARANTINE_CAP = 5;
export const UNFILED = "unfiled";

export function readQuarantine(path = QUARANTINE_FILE): Quarantined[] {
  if (!existsSync(path)) return [];
  const list: unknown = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(list) ? (list as Quarantined[]) : [];
}

export const writeQuarantine = (list: Quarantined[], path = QUARANTINE_FILE): void => writeFileSync(path, `${JSON.stringify(list, null, 2)}\n`);

const rootFile = (f: Failure, prefix: string) => `${prefix}${f.file.replace(/^\.\//, "")}`;

/** The `-t` pattern that picks one test: bun joins the describe names with spaces and takes a regex. */
export const onlyThisTest = (name: string): string =>
  `^${name
    .split(" > ")
    .join(" ")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;

export interface Verdict {
  /** failures that still fail the check: failed alone too, or a flake past the cap */
  failing: Failure[];
  /** flakes already in quarantine */
  ignored: Failure[];
  /** flakes this run added to quarantine */
  added: Quarantined[];
  list: Quarantined[];
}

/** Judges a failed step. `passesAlone` reruns one failure on its own; `prefix` is the step's folder (`server/`). */
export function judge(failures: Failure[], list: Quarantined[], passesAlone: (f: Failure) => boolean, prefix = ""): Verdict {
  const failing: Failure[] = [];
  const ignored: Failure[] = [];
  const added: Quarantined[] = [];
  const next = [...list];
  for (const f of failures) {
    if (!passesAlone(f)) {
      failing.push(f);
      continue;
    }
    const file = rootFile(f, prefix);
    if (next.some((q) => q.file === file && q.test === f.test)) ignored.push(f);
    else if (next.length < QUARANTINE_CAP) {
      const entry = { file, test: f.test, task: UNFILED };
      next.push(entry);
      added.push(entry);
    } else failing.push(f);
  }
  return { failing, ignored, added, list: next };
}

/** Reruns a failure alone with bun in `cwd`. */
export function bunPassesAlone(cwd: string, env: Record<string, string | undefined>): (f: Failure) => boolean {
  return (f) =>
    Bun.spawnSync(["bun", "test", "--timeout", "120000", f.file, "-t", onlyThisTest(f.test)], { cwd, env, stdout: "ignore", stderr: "ignore" }).success;
}
