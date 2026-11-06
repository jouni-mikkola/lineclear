// Reads the files another build wrote with this build's code: `bun scripts/formats.ts <repo> [<store>] [--older]` prints one line
// per file it cannot read as that build meant it and exits 1 if there is one: the roadmap of <repo> with this build's
// roadmap check, and the store files in <store> with this build's server (server/scripts/store-formats.ts). A promotion
// runs stable's copy on next's files and next's copy on stable's store.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkRoadmap } from "../src/roadmap.ts";

function roadmap(repo: string): string[] {
  const file = join(repo, "docs", "ROADMAP.md");
  if (!existsSync(file)) return [];
  return checkRoadmap(readFileSync(file, "utf8")).errors.map((e) => `docs/ROADMAP.md:${e.line}: ${e.message}`);
}

/** What this build cannot read in `repo` and `store`; empty when it reads all. */
export function unreadable(repo: string, store?: string, older = false): string[] {
  const out = roadmap(repo);
  if (!store) return out;
  const server = join(import.meta.dir, "..", "server");
  const args = [join(server, "scripts", "store-formats.ts"), "read", store, ...(older ? ["--older"] : [])];
  const r = spawnSync("bun", args, { cwd: server, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) out.push(...`${r.stdout}${r.stderr}`.trim().split("\n").filter(Boolean));
  return out;
}

if (import.meta.main) {
  const [repo, store] = process.argv.slice(2).filter((a) => a !== "--older");
  if (!repo) {
    console.error("usage: formats.ts <repo> [<store>]");
    process.exit(2);
  }
  const bad = unreadable(repo, store, process.argv.includes("--older"));
  for (const b of bad) console.log(b);
  process.exit(bad.length ? 1 : 0);
}
