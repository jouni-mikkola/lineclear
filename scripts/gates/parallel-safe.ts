// A test must hold when several copies run at once on one machine: it binds no fixed port, writes only inside its temp folder
// and waits on an event (`waitFor`, `until`), never on a counted loop of sleeps.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { trackedFiles } from "./tools.ts";

const TEST_FILE = /(^|\/)(test|tests)\/.*\.[cm]?[jt]sx?$|\.(test|spec|pw)\.[cm]?[jt]sx?$/;
const FIXED_PORT = /(\bserve|\blisten)\(.*\bport:\s*[1-9]\d*\b|\.listen\(\s*[1-9]\d*\b/;
const OUTSIDE_WRITE =
  /\b(writeFileSync|appendFileSync|mkdirSync|rmSync|renameSync|copyFileSync|Bun\.write)\(\s*(["'`]\/|["'`]~|homedir\(\)|process\.env\.HOME\b)/;
const COUNTED_LOOP = /\bfor\s*\(.*(<|<=)\s*\d[\d_]*\s*[;&]/;
const SLEEP = /\bsleep\(/i;
const SLEEP_REACH = 2;
const OPENS_BLOCK = /\{\s*$/;

/** The faults of one test file's text, each with its line. */
export function parallelFaults(file: string, text: string): string[] {
  const lines = text.split("\n");
  const faults: string[] = [];
  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    if (FIXED_PORT.test(line)) faults.push(`${at} binds a fixed port; bind port 0 and read the port back`);
    if (OUTSIDE_WRITE.test(line)) faults.push(`${at} writes outside its temp folder; use tmp() or mkdtemp`);
    if (COUNTED_LOOP.test(line) && lines.slice(i, i + (OPENS_BLOCK.test(line) ? 1 + SLEEP_REACH : 1)).some((l) => SLEEP.test(l)))
      faults.push(`${at} polls with a fixed count of sleeps; use waitFor(condition, what) or until(condition, what)`);
  });
  return faults;
}

/** The gate's own test holds the faulty samples it checks, so it is the one file left out. */
const SAMPLES = "test/parallel-safe.test.ts";

export async function parallelSafe(root: string): Promise<string[]> {
  return trackedFiles(root, TEST_FILE)
    .filter((f) => f !== SAMPLES)
    .flatMap((f) => parallelFaults(f, readFileSync(join(root, f), "utf8")));
}
