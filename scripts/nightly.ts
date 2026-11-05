// Runs the checks too slow for a merge (src/nightly.ts): the whole-repo gates and the coverage floors. A release
// runs it first (`bun run media release`) and does not go out when it fails. The rule loop starts it each night with
// `--out <file>`, which gets the failures as JSON instead of an exit code.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { slowFailures } from "../src/nightly.ts";
import type { Numbers } from "../src/measure.ts";
import { measureMain } from "../src/measure-main.ts";
import { proposeTiers } from "../src/project.ts";
import { findProject } from "../src/waits.ts";
import { askGoal, askGoalFailure, askGoalLine } from "../src/ask-goal.ts";
import { costGoal, costGoalFailure, costGoalLine } from "../src/cost-goal.ts";
import { appendGoalLine, goalSince, waitGoal, waitGoalFailure, waitGoalLine } from "../src/wait-goal.ts";

/** The goals read from one `lineclear measure` of the last three days (L238, L242, L245): each is recorded in docs/numbers.md and fails past its limit. A repo that is no project, or has no docs/numbers.md, keeps none. */
function goalChecks(repo: string): { name: string; output: string }[] {
  const project = findProject(repo);
  if (project === undefined || !existsSync(join(repo, "docs", "numbers.md"))) return [];
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  const code = measureMain([project, "--since", goalSince(today), "--json"], (l) => lines.push(l));
  if (code !== 0) return [{ name: "goals", output: `lineclear measure failed\n${lines.join("\n")}`.slice(-4000) }];
  const numbers = JSON.parse(lines.join("\n")) as Numbers;
  const wait = waitGoal(numbers, today);
  const cost = costGoal(numbers);
  const asks = askGoal(numbers, today);
  const file = join(repo, "docs", "numbers.md");
  const text = appendGoalLine(readFileSync(file, "utf8"), waitGoalLine(wait, today));
  const withCost = appendGoalLine(text, costGoalLine(cost, today), "L242");
  writeFileSync(file, appendGoalLine(withCost, askGoalLine(asks, today), "L245"));
  return [
    { name: "wait goal", output: waitGoalFailure(wait) },
    { name: "cost goal", output: costGoalFailure(cost) },
    { name: "ask goal", output: askGoalFailure(asks) },
  ].flatMap((f) => (f.output ? [{ name: f.name, output: f.output }] : []));
}

// `bun run nightly` runs this repo's nightly tier; the rule loop passes the project's own commands after `--out <file>`.
const args = process.argv.slice(2);
const out = args.indexOf("--out");
const given = out >= 0 ? args.slice(out + 2) : [];
const commands = given.length > 0 ? given : proposeTiers(process.cwd(), "bun run check").nightly.commands;
const failures = [...slowFailures(process.cwd(), commands), ...goalChecks(process.cwd())];
if (out >= 0) {
  const file = String(args[out + 1]);
  writeFileSync(`${file}.tmp`, JSON.stringify(failures));
  renameSync(`${file}.tmp`, file);
  process.exit(0);
}
for (const f of failures) console.error(`nightly: ${f.name} failed\n${f.output}`);
console.log(failures.length ? `nightly: ${failures.length} check(s) failed` : "nightly: every slow check passed");
process.exit(failures.length ? 1 : 0);
