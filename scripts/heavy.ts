// Runs the checks too slow for a merge (src/heavy-run.ts): the whole-repo gates and the coverage floors. A release
// runs it first (`bun run media release`) and does not go out when it fails. The rule loop starts it after main moves, in a repo with no heavy workflow, with
// `--out <file>`, which gets the failures as JSON instead of an exit code.
import { renameSync, writeFileSync } from "node:fs";
import { slowFailures } from "../src/heavy-run.ts";
import { proposeTiers } from "../src/project.ts";

// `bun run heavy` runs this repo's heavy tier; the rule loop passes the project's own commands after `--out <file>`.
const args = process.argv.slice(2);
const out = args.indexOf("--out");
const given = out >= 0 ? args.slice(out + 2) : [];
const commands = given.length > 0 ? given : proposeTiers(process.cwd(), "bun run check").heavy.commands;
const failures = [...slowFailures(process.cwd(), commands)];
if (out >= 0) {
  const file = String(args[out + 1]);
  writeFileSync(`${file}.tmp`, JSON.stringify(failures));
  renameSync(`${file}.tmp`, file);
  process.exit(0);
}
for (const f of failures) console.error(`heavy: ${f.name} failed\n${f.output}`);
console.log(failures.length ? `heavy: ${failures.length} check(s) failed` : "heavy: every slow check passed");
process.exit(failures.length ? 1 : 0);
