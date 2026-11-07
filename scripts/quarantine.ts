// Flaky tests: a failure that passes when run alone is a flake. A listed flake no longer fails the check, one that
// fails alone too always does. The list is capped so quarantine cannot hide a broken suite.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Failure } from "./failures.ts";

export const QUARANTINE_FILE = "test/quarantine.json";
export const QUARANTINE_MAX = 5;

export interface Quarantined {
  /** `<file> > <test>`, the file from the repo root */
  test: string;
  /** the task that fixes it; empty until one is filed */
  fix: string;
}

export const readQuarantine = (path = QUARANTINE_FILE): Quarantined[] => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : []);

export const testKey = (prefix: string, f: Failure): string => `${prefix}${f.file.replace(/^\.\//, "")} > ${f.test}`;

export interface Verdict {
  ok: boolean;
  /** flakes that passed alone and are listed: ignored */
  ignored: string[];
  /** flakes that passed alone, are not listed and now join the list */
  added: string[];
  /** why the check still fails */
  faults: string[];
}

/** `alone` maps each failure's key to whether it passed when run alone. */
export function judge(keys: string[], alone: Map<string, boolean>, listed: Quarantined[]): Verdict {
  const known = new Set(listed.map((q) => q.test));
  const faults: string[] = [];
  const ignored: string[] = [];
  const added: string[] = [];
  for (const key of keys) {
    if (!alone.get(key)) faults.push(`${key} fails alone too`);
    else if (known.has(key)) ignored.push(key);
    else added.push(key);
  }
  if (listed.length + added.length > QUARANTINE_MAX) {
    faults.push(`quarantine would hold ${listed.length + added.length} tests, the limit is ${QUARANTINE_MAX}: fix one first (${added.join(", ")})`);
  }
  return { ok: faults.length === 0, ignored, added, faults };
}

/** Runs one failed test alone, in the folder its step ran in. True when it passes. */
export function passesAlone(f: Failure, cwd: string | undefined, env: Record<string, string | undefined>): boolean {
  const name = f.test.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const r = Bun.spawnSync(["bun", "test", "--timeout", "120000", f.file, "-t", `^${name}$`], { cwd, env, stdout: "ignore", stderr: "ignore" });
  return r.success;
}

export function addQuarantine(added: string[], path = QUARANTINE_FILE): void {
  if (added.length === 0) return;
  writeFileSync(path, `${JSON.stringify([...readQuarantine(path), ...added.map((test) => ({ test, fix: "" }))], null, 2)}\n`);
}
