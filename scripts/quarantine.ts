// Flaky tests: a failure that passes when run alone is a flake. A quarantined flake no longer fails the check.
import { existsSync, readFileSync } from "node:fs";
import type { Failure } from "./failures.ts";

export const MAX_QUARANTINED = 5;

export interface Quarantined {
  file: string;
  test: string;
  /** the task that fixes the flake */
  task: string;
}

export const quarantineKey = (f: { file: string; test: string }): string => `${f.file.replace(/^\.\//, "")}: ${f.test}`;

export function readQuarantine(path = "test/quarantine.json"): Quarantined[] {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Quarantined[]) : [];
}

export interface Verdict {
  /** true when the failures no longer fail the check */
  ok: boolean;
  /** why it fails, one line each */
  faults: string[];
}

/** `alone` tells whether a failure passed when rerun alone. The check passes only when every failure is a quarantined flake. */
export function judge(failures: Failure[], alone: (f: Failure) => boolean, quarantine: Quarantined[]): Verdict {
  const faults: string[] = [];
  if (quarantine.length > MAX_QUARANTINED) faults.push(`${quarantine.length} tests are in quarantine, at most ${MAX_QUARANTINED}: fix one first`);
  const listed = new Set(quarantine.map(quarantineKey));
  for (const f of failures) {
    if (!alone(f)) faults.push(`${quarantineKey(f)} failed alone too`);
    else if (!listed.has(quarantineKey(f))) faults.push(`${quarantineKey(f)} is flaky: add it to test/quarantine.json with its fix task's id`);
  }
  return { ok: failures.length > 0 && faults.length === 0, faults };
}
