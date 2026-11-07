// The repo files each root test really loads, its own process and the bun processes it spawns included, so
// `check --changed` runs the tests a change reaches and no others (scripts/changed.ts). test/load-map-preload.ts records
// the loads during a run of the whole suite; the map is saved under the cache by the commit it was recorded on.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "../src/tmpdirs.ts";
import { git } from "../src/git.ts";
import { differingFrom } from "./gates/tools.ts";

export interface LoadMap {
  commit: string;
  /** Files that differed from the commit when it was recorded. */
  dirty: string[];
  /** Test file -> every repo file it loads. */
  tests: Record<string, string[]>;
}

interface Dump {
  owner?: string;
  edges: [string, string][];
}

const KEEP = 8;
const mapDir = () => join(cacheDir(), "load-map");

/** The map of the dumps a run left in `dir`: a test's own process by the imports it followed, plus what its children loaded. */
export function buildMap(dir: string, tests: string[]): Record<string, string[]> {
  const dumps = existsSync(dir) ? readdirSync(dir).map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")) as Dump) : [];
  const into = new Map<string, Set<string>>();
  const extra = new Map<string, Set<string>>();
  for (const d of dumps) {
    for (const [from, to] of d.edges) {
      if (d.owner === undefined) into.set(from, (into.get(from) ?? new Set()).add(to));
      else extra.set(d.owner, (extra.get(d.owner) ?? new Set([d.owner])).add(to).add(from));
    }
  }
  const map: Record<string, string[]> = {};
  for (const test of tests) {
    // a test file that no process loaded is unknown, not empty: it always runs
    if (!into.get("")?.has(test)) continue;
    const seen = new Set([test, ...(extra.get(test) ?? [])]);
    const queue = [test];
    for (let f = queue.pop(); f !== undefined; f = queue.pop()) {
      for (const to of into.get(f) ?? []) {
        if (seen.has(to)) continue;
        seen.add(to);
        queue.push(to);
      }
    }
    seen.delete("");
    map[test] = [...seen].sort();
  }
  return map;
}

/** Saves the map of the commit the tree is on; keeps the newest few. */
export function saveMap(root: string, tests: Record<string, string[]>): void {
  const head = git(root, "rev-parse", "HEAD");
  const dirty = differingFrom(root, "HEAD");
  if (!head.ok || dirty === undefined) return;
  const commit = head.out.trim();
  const dir = mapDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${commit}.json`), JSON.stringify({ commit, dirty, tests } satisfies LoadMap));
  const old = readdirSync(dir)
    .map((n) => ({ n, at: statSync(join(dir, n)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .slice(KEEP);
  for (const { n } of old) rmSync(join(dir, n), { force: true });
}

/**
 * The newest saved map whose commit this repo knows, with the files that changed since it was recorded: a change
 * after the commit can add an import the map does not show, so those files count as changed too.
 */
export function readMap(root: string): { tests: Record<string, string[]>; drift: string[] } | undefined {
  const dir = mapDir();
  if (!existsSync(dir)) return undefined;
  const newest = readdirSync(dir)
    .map((n) => ({ n, at: statSync(join(dir, n)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const { n } of newest) {
    const map = JSON.parse(readFileSync(join(dir, n), "utf8")) as LoadMap;
    const drift = differingFrom(root, map.commit);
    if (drift) return { tests: map.tests, drift: [...new Set([...drift, ...map.dirty])] };
  }
  return undefined;
}
