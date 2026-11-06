// Fails on a commit message of the branch (since main) or a CHANGELOG line that breaks the prose rule (src/prose.ts).
import { readFileSync } from "node:fs";
import { proseFaults } from "../src/prose.ts";

const root = process.argv[2] ?? ".";
const git = (...args: string[]) => Bun.spawnSync(["git", "-C", root, ...args]).stdout.toString();
const problems: string[] = [];

const base = git("merge-base", "main", "HEAD").trim();
const log = base ? git("log", "--format=%H%x00%B%x01", `${base}..HEAD`) : "";
for (const entry of log
  .split("\x01")
  .map((e) => e.trim())
  .filter(Boolean)) {
  const [sha = "", message = ""] = entry.split("\0");
  for (const f of proseFaults(message)) problems.push(`commit ${sha.slice(0, 8)}: ${f}`);
}

const changelog = readFileSync(`${root}/CHANGELOG.md`, "utf8").split("\n");
changelog.forEach((line, i) => {
  for (const f of proseFaults(line)) problems.push(`CHANGELOG.md:${i + 1}: ${f}`);
});

for (const p of problems) console.error(p);
if (problems.length > 0) console.error("prose check: rewrite the text in short plain English (src/prose.ts)");
process.exit(problems.length > 0 ? 1 : 0);
