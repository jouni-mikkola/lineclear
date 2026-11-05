import { readFileSync, statSync } from "node:fs";
import { findDashes, type DashHit } from "../src/dashes.ts";
import { changedSince } from "./gates/tools.ts";

const root = process.argv[2] ?? ".";
// --changed: only the files changed since main, for the worker's loop (the full check reads every file)
const only = process.argv.includes("--changed") ? changedSince(root, "main") : undefined;
const listed = Bun.spawnSync(["git", "-C", root, "ls-files", "-z"]);
if (listed.exitCode !== 0) {
  console.error("dash check: not a git repository");
  process.exit(2);
}

const hits: DashHit[] = [];
for (const file of only ?? listed.stdout.toString().split("\0").filter(Boolean)) {
  const path = `${root}/${file}`;
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) continue; // deleted or a submodule
  const bytes = readFileSync(path);
  if (bytes.includes(0)) continue; // binary
  hits.push(...findDashes(file, bytes.toString("utf8")));
}

for (const h of hits) console.error(`${h.file}:${h.line}: ${h.char}`);
process.exit(hits.length > 0 ? 1 : 0);
