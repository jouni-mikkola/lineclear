// Runs the root tests with line coverage and fails when a module is below its floor (scripts/gates/baseline/coverage.json).
// `--raise` lifts the floors to what is measured; a floor only rises. Run by the nightly job and a release, not by the check.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { belowFloor, fileCoverage, withUnloaded, linesPerModule, raise, readFloors, writeFloors } from "./gates/coverage.ts";

const root = join(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "lineclear-coverage-"));
// a failing test is the check's to report; the floors are about what the tests reach. Coverage makes the whole run
// slower, so a test gets 60 s: a timeout would cut its lines out of the count.
Bun.spawnSync(["bun", "test", "./test", "--timeout=60000", "--coverage", "--coverage-reporter=lcov", `--coverage-dir=${dir}`], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
// the root tests load only what they reach, so a tracked source file none loads would be missing from the report
const ignored: string[] = (/coveragePathIgnorePatterns = \[(.*)\]/.exec(readFileSync(join(root, "bunfig.toml"), "utf8"))?.[1] ?? "").match(/[^"]+\.ts/g) ?? [];
// only code the root tests are meant to reach counts when no test loads it: the server, Playwright, the repo's own
// drivers and the eval run under other runners
const reachedHere = /^(src\/|bin\/|pi\/|ui\/(brand|kit)\/)/;
const sources = Object.fromEntries(
  Bun.spawnSync(["git", "ls-files", "*.ts", "*.tsx", "bin/lineclear"], { cwd: root })
    .stdout.toString()
    .split("\n")
    .filter(
      (f) =>
        f &&
        !ignored.includes(f) &&
        !f.endsWith(".d.ts") &&
        !f.includes(".test.") &&
        !f.startsWith("docs/") &&
        reachedHere.test(f) &&
        !f.startsWith("test/fixtures/"),
    )
    .map((f) => [f, readFileSync(join(root, f), "utf8")]),
);
const lcov = withUnloaded(readFileSync(join(dir, "lcov.info"), "utf8"), sources);
const architecture = readFileSync(join(root, "docs/architecture.md"), "utf8");
const lines = linesPerModule(lcov, architecture);
const floors = readFloors(root);
// the last measure per file, which `lineclear measure` reads for part health
mkdirSync(join(root, ".coverage"), { recursive: true });
writeFileSync(join(root, ".coverage", "files.json"), JSON.stringify(fileCoverage(lcov, architecture, floors)));
if (process.argv.includes("--raise")) {
  writeFloors(root, raise(lines, floors));
  console.log("coverage: floors raised");
  process.exit(0);
}
const faults = belowFloor(lines, floors);
for (const f of faults) console.error(`coverage: ${f}`);
console.log(faults.length ? `coverage: ${faults.length} module(s) below their floor` : "coverage: every module is at its floor or above");
process.exit(faults.length ? 1 : 0);
