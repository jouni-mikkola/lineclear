// Flaky tests: a failure that passes when run alone is a flake. A listed one no longer fails the check. An unlisted one
// passes the run while the list has room under the cap and is named in the output: a runner commits nothing, so the
// filer of its fix task adds it to test/quarantine.json. A failure alone too always fails.
import { existsSync, readFileSync } from "node:fs";
import type { Failure } from "./failures.ts";

export interface Quarantined {
  /** the test file as the repo root names it, `server/test/x.test.ts` for the server's */
  file: string;
  test: string;
  /** the task that fixes it */
  task: string;
}

export const QUARANTINE_FILE = "test/quarantine.json";
export const QUARANTINE_CAP = 5;

export function readQuarantine(path = QUARANTINE_FILE): Quarantined[] {
  if (!existsSync(path)) return [];
  const list: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(list)) return [];
  return list.filter((q): q is Quarantined => typeof q?.file === "string" && typeof q.test === "string" && typeof q.task === "string");
}

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
  /** flakes not yet in quarantine that the run lets through */
  fresh: Failure[];
}

/** Judges a failed step. `passesAlone` reruns one failure on its own; `prefix` is the step's folder (`server/`). */
export function judge(failures: Failure[], list: Quarantined[], passesAlone: (f: Failure) => boolean, prefix = ""): Verdict {
  const failing: Failure[] = [];
  const ignored: Failure[] = [];
  const fresh: Failure[] = [];
  for (const f of failures) {
    if (!passesAlone(f)) {
      failing.push(f);
      continue;
    }
    const file = rootFile(f, prefix);
    if (list.some((q) => q.file === file && q.test === f.test)) ignored.push(f);
    else if (list.length + fresh.length < QUARANTINE_CAP) fresh.push(f);
    else failing.push(f);
  }
  return { failing, ignored, fresh };
}

/** True when the output's counts are all the failures read from it: a load error or a crash has no `(fail)` line. */
export const fullyParsed = (output: string, failures: number): boolean =>
  Number(/^\s*(\d+) fail$/m.exec(output)?.[1]) === failures && !/^\s*\d+ errors?$/m.test(output);

/** Reruns a failure alone with bun in `cwd`: it must pass, and run exactly that one test. */
export function bunPassesAlone(cwd: string, env: Record<string, string | undefined>): (f: Failure) => boolean {
  return (f) => {
    const r = Bun.spawnSync(["bun", "test", "--timeout", "120000", f.file, "-t", onlyThisTest(f.test)], { cwd, env });
    return r.success && /^\s*1 pass$/m.test(r.stdout.toString() + r.stderr.toString());
  };
}
