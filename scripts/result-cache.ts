// A test file's passing result is stored in the check log (src/check-runs.ts) under the hash of what it loads (the load map, scripts/load-map.ts): a file whose
// own text and every file it loads are unchanged, on the same bun and lockfile, does not run again. A full run
// (`check --full`, the release) ignores the cache, so it also catches a load the map missed.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readPasses, recordPasses } from "../src/check-runs.ts";

const textOf = (root: string, file: string): string => {
  try {
    return readFileSync(join(root, file), "utf8");
  } catch {
    return "";
  }
};

/** The key of a test file: its own text and the text of every file it loads, the bun version and the lockfile. */
export function testKey(root: string, file: string, loads: string[], salt: string): string {
  const h = createHash("sha256");
  h.update(salt);
  h.update(textOf(root, "bun.lock"));
  // a test also reads files it names by path (docs, templates): they are part of its key
  const named = (textOf(root, file).match(/[\w./-]+\.(?:md|json|txt|html|css|sh)\b/g) ?? []).filter((n) => existsSync(join(root, n)));
  for (const f of [...new Set([file, ...loads, ...named])].sort()) h.update(`\0${f}\0${textOf(root, f)}`);
  return h.digest("hex");
}

/** The files (as `./test/x.test.ts`) that passed before with the same key, and the files that must run. */
export function splitCached(
  root: string,
  files: string[],
  map: Record<string, string[]>,
  salt: string,
): { cached: string[]; run: string[]; keys: Record<string, string> } {
  const passed = readPasses(root);
  const keys: Record<string, string> = {};
  const cached: string[] = [];
  const run: string[] = [];
  for (const f of files) {
    const name = f.replace(/^\.\//, "");
    const loads = map[name];
    // a file the map does not know always runs
    if (!loads) {
      run.push(f);
      continue;
    }
    keys[f] = testKey(root, name, loads, salt);
    (passed[name] === keys[f] ? cached : run).push(f);
  }
  return { cached, run, keys };
}

/** Remembers the keys of the files that passed, as one line of the check log. */
export function recordPassed(root: string, keys: Record<string, string>, files: string[]): void {
  recordPasses(root, Object.fromEntries(files.flatMap((f) => (keys[f] ? [[f.replace(/^\.\//, ""), keys[f]]] : []))));
}
