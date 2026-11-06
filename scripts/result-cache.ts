// A test file's passing result is cached by the hash of what it loads (the load map, scripts/load-map.ts): a file whose
// own text and every file it loads are unchanged, on the same bun and lockfile, does not run again. A full run
// (`check --full`, the release) ignores the cache, so it also catches a load the map missed.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "../src/tmpdirs.ts";

const KEEP = 5000;
const path = () => join(cacheDir(), "test-results.json");

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

function read(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(path(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

/** The files (as `./test/x.test.ts`) that passed before with the same key, and the files that must run. */
export function splitCached(
  root: string,
  files: string[],
  map: Record<string, string[]>,
  salt: string,
): { cached: string[]; run: string[]; keys: Record<string, string> } {
  const passed = read();
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

/** Remembers the keys of the files that passed. */
export function recordPassed(keys: Record<string, string>, files: string[]): void {
  const next = read();
  for (const f of files) if (keys[f]) next[f.replace(/^\.\//, "")] = keys[f] as string;
  const kept = Object.fromEntries(Object.entries(next).slice(-KEEP));
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(path(), JSON.stringify(kept));
}
