// The one check: Lineclear's types, tests, roadmap, part pages and code gates (scripts/gates/),
// then the server's own types and tests (server/).
// `bun run check` is the merge lane's: only what the branch's change reaches (below), the independent steps side by side,
// each step's time recorded (scripts/check-speed.ts) and a file or the whole run over its limit failed by name.
// `--full` runs everything the light check has, never a browser: checks are light and run on GitHub (docs/numbers.md). `--changed`
// is the worker's loop.
// The budget is 180 s on a machine that is not busy (docs/numbers.md); a busy one is slower for reasons outside the change.
// Tests never run on an owner's machine: GitHub runs them (.github/workflows/check.yml). Here only the types run;
// `lineclear pr` pushes the branch and `lineclear checks` waits for GitHub's result.
if (!process.env.GITHUB_ACTIONS) {
  const types = Bun.spawnSync(["bunx", "tsc", "--noEmit", "--incremental", "--tsBuildInfoFile", "node_modules/.cache/tsc-changed.tsbuildinfo"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  console.log(types.success ? "check: types passed; the tests run on GitHub (lineclear pr, then lineclear checks)" : "check: types failed");
  process.exit(types.success ? 0 : 1);
}
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { compileCacheDir, diskTmpRoot, trimCache } from "../src/tmpdirs.ts";
import { testsFor } from "./changed.ts";
import { buildMap, readMap, saveMap } from "./load-map.ts";
import {
  junitSlowestCase,
  junitTimes,
  loadFactorMeter,
  lowered,
  overBudget,
  readSlowBaseline,
  readTimes,
  slowFails,
  slowFaults,
  split,
  type StepTime,
  table,
  type Times,
  writeSlowBaseline,
  writeTimes,
} from "./check-speed.ts";
import { fastGates } from "./fast-gates.ts";
import { describeFailure, type Failure, outsideChange, parseFailures } from "./failures.ts";
import { changedSince } from "./gates/tools.ts";
import { judge, readQuarantine, runAlone, withQuarantined } from "./quarantine.ts";

// Every step but the server's (below) runs with TMPDIR in a folder of this run, on disk. Each test process clears its own
// folder inside it (tmp-scope.ts), so anything left in it when the steps end was left by a process that did not get
// to: that fails the check.
// The run's folder is on disk, not in /tmp (RAM on many machines), and so is the runtime's compile cache, capped.
const runTmp = mkdtempSync(join(diskTmpRoot(), "lc-check-"));
// A playwright daemon keeps its session files in a cache dir shared by default: each run gets its own, so a daemon of another run never writes into this one's HOME.
const env = { ...process.env, TMPDIR: runTmp, NODE_COMPILE_CACHE: compileCacheDir(), PWTEST_DAEMON_SESSION_DIR: join(runTmp, "playwright-daemon") };
// The server's tests bind unix sockets under their temp folder, and a socket path stops at 107 bytes: one more folder
// level puts them over it. They get the temp root, where their own tmp-scope.ts still clears what they make.
const serverEnv = { ...env, TMPDIR: diskTmpRoot(), ...(process.argv.includes("--changed") ? { LINECLEAR_TEST_JOBS: "4" } : {}) };
// reports of this run's test runners, outside the folders the tests are checked to leave clean
const reports = join(runTmp, "reports");
mkdirSync(reports);
// the repo's bin/lineclear refuses the stable config, data folders and ports (src/paths.ts), and a lane's shell may carry
// the stable ports; these commands listen on none
const ownFolders = [`LINECLEAR_CONFIG=${join(reports, "config")}`, `LINECLEAR_HOME=${join(reports, "home")}`, "LINECLEAR_PORT=0", "LINECLEAR_WEB_PORT=0"];
const finish = (code: number): never => {
  trimCache(compileCacheDir());
  // jiti is the code gates' own transpile cache and playwright-daemon the browser sessions': not a test's folders
  // the UI suite's fixture is removed on its next start, and a browser killed by a failed spec never clears its profile: a failed run leaves both
  const left = readdirSync(runTmp).filter(
    (n) =>
      n !== "jiti" &&
      n !== "playwright-daemon" &&
      !(code !== 0 && n.startsWith("playwright_chromiumdev_profile-")) &&
      !n.startsWith("playwright-transform-cache") &&
      n !== "reports",
  );
  rmSync(runTmp, { recursive: true, force: true });
  if (left.length > 0) {
    console.error(`check: the tests left ${left.length} folder${left.length === 1 ? "" : "s"} behind: ${left.slice(0, 10).join(" ")}`);
    process.exit(1);
  }
  process.exit(code);
};

/** A step waits for the steps it `needs` and does not run when one of them failed. */
type Step = { name: string; cmd: string[]; cwd?: string; needs?: string[] };

const full = process.argv.includes("--full");
const onlyChanged = process.argv.includes("--changed");
// the release run: load decides a test file's time there, not the code, so the times are recorded and not judged
const untimed = process.argv.includes("--untimed");
const lowering = process.argv.includes("--lower-slow");
// the first baseline, or a slow file taken in on purpose: --lower-slow alone never adds a file
const adding = process.argv.includes("--add-slow");
// no main to compare with: nothing is known to be unchanged, so everything runs
const known = full ? undefined : changedSince(".", "main");
const changed = known ?? [];
const isDoc = (f: string) => f.startsWith("docs/") || f.endsWith(".md");
// a change of docs alone reaches the doc checks and the tests that name the doc, and nothing else
const code = known === undefined || changed.some((f) => !isDoc(f));
// the server imports src/check-runs.ts (docs/architecture.md)
const inServer = known === undefined || changed.some((f) => (f.startsWith("server/") && !isDoc(f)) || f === "src/check-runs.ts");
const outsideServer = known === undefined || changed.some((f) => !f.startsWith("server/") && !isDoc(f));
// the incremental build is kept between runs: the second run of the types takes a fraction of the first
const TSC_CHANGED = ["bunx", "tsc", "--noEmit", "--incremental", "--tsBuildInfoFile", "node_modules/.cache/tsc-changed.tsbuildinfo"];
// the most test processes at once: the worker's loop, the lane and the server's tests alike
const TEST_SHARDS = 4;
// a GitHub runner has 4 cores: each job runs its share of the test files in this many processes
const SHARD_PROCESSES = 2;
// install.sh builds the web pages with vite for real: a run on GitHub, never in a worker's loop
const BUILDING_TESTS = ["test/install.test.ts", "test/install-update.test.ts", "test/install-release.test.ts"];

// the tests the change reaches: a failure in any other file is not the change's
// none when the change reaches every test or the whole run is asked for: then no failure is outside it
// `--shard=i/n` (the GitHub job): this job's share of the steps and test files, balanced by time (below)
const shardArg = process.argv.find((a) => a.startsWith("--shard="))?.match(/^--shard=(\d+)\/(\d+)$/);
const shard = shardArg ? { i: Number(shardArg[1]), n: Number(shardArg[2]) } : undefined;
// seconds on a runner of the steps that stay whole; the server's tests are split by bun itself, so every shard has an equal part
const WHOLE_STEPS: [string, number][] = [
  ["types", 9],
  ["server types", 6],
  ["gates", 3],
  ["roadmap", 1],
];
const SERVER_TESTS_S = 44;
const shardLoads = (n: number) => {
  const loads = Array.from({ length: n }, () => SERVER_TESTS_S / n);
  const homes = new Map<string, number>();
  for (const [name, seconds] of WHOLE_STEPS) {
    const at = loads.indexOf(Math.min(...loads));
    loads[at] = (loads[at] ?? 0) + seconds;
    homes.set(name, at);
  }
  return { loads, homes };
};

const reached = known ? testsFor(".", changed) : undefined;
const touched = reached ? new Set([...changed, ...reached]) : undefined;

const allTests = () => Array.from(new Bun.Glob("test/**/*.test.{ts,tsx}").scanSync(".")).map((f) => `./${f}`);

const SERVER_INSTALL: Step = { name: "server install", cmd: ["bun", "install", "--frozen-lockfile"], cwd: "server" };

// a run of the whole suite records which files each test loads (scripts/load-map.ts) for the next changed run
const loadDir = join(reports, "loads");
let recording = false;

function testSteps(): Step[] {
  const map = known ? readMap(".") : undefined;
  const reachedFiles = known
    ? testsFor(".", changed, map)
        ?.filter((f) => existsSync(f) && !(onlyChanged && BUILDING_TESTS.includes(f)))
        .map((f) => `./${f}`)
    : undefined;
  const files = reachedFiles;
  if (files?.length === 0) return [];
  const list = files ?? allTests();
  if (files === undefined) {
    recording = true;
    Object.assign(env, { LINECLEAR_LOAD_MAP: loadDir, LINECLEAR_LOAD_ROOT: process.cwd() });
  }
  // an install test is far slower than its size says: the committed baseline of slow files weighs it, the last run's times override
  const weights = { ...readSlowBaseline(), ...readTimes() };
  // bun test with no file runs every test it finds, the server's too: a share with no file runs no process
  const runs = (
    shard
      ? split(split(list, shard.n, weights, shardLoads(shard.n).loads)[shard.i - 1] ?? [], SHARD_PROCESSES, weights)
      : split(list, Math.min(TEST_SHARDS, Math.max(1, Math.ceil(list.length / 6))), readTimes())
  ).filter((run) => run.length > 0);
  // a test waits for its event, never for a time: the limit only stops a hang, so a busy machine never reaches it
  // the tests import the server's dependencies: an install under way (a fresh worktree, a moved lockfile) leaves
  // them half there, so the tests wait for it
  const installs = !(onlyChanged && serverInstalled()) && (inServer || !existsSync("server/node_modules"));
  const needs = installs ? [SERVER_INSTALL.name] : [];
  const tests = runs.map((run, i) => ({
    name: runs.length === 1 ? "tests" : `tests ${i + 1}/${runs.length}`,
    ...(needs.length ? { needs } : {}),
    cmd: ["bun", "test", "--timeout", "120000", "--reporter=junit", `--reporter-outfile=${join(reports, `unit-${i}.xml`)}`, ...run],
  }));
  return [...(installs && !inServer ? [SERVER_INSTALL] : []), ...tests];
}

// a worker's loop reuses the installed server packages unless the lockfile or package.json is newer than them
const serverInstalled = () => {
  if (!existsSync("server/node_modules")) return false;
  const at = (f: string) => (existsSync(f) ? statSync(f).mtimeMs : 0);
  return at("server/node_modules") >= Math.max(at("server/package.json"), at("server/bun.lock"));
};
const serverNeeds = () => (onlyChanged && serverInstalled() ? [] : ["server install"]);

function serverSteps(): Step[] {
  if (!inServer) return [];
  return [
    ...(serverNeeds().length ? [SERVER_INSTALL] : []),
    { name: "server types", cmd: ["bun", "run", full || known === undefined ? "typecheck" : "typecheck:changed"], cwd: "server", needs: serverNeeds() },
    {
      name: "server tests",
      cmd: ["bun", "scripts/test.ts", full || known === undefined ? "--force" : "changed", ...(shard ? [`--shard=${shard.i}/${shard.n}`] : [])],
      cwd: "server",
      needs: serverNeeds(),
    },
  ];
}

function steps(): Step[] {
  const base = [
    ...(outsideServer && (code || full) ? [{ name: "types", cmd: full || known === undefined ? ["bun", "run", "types"] : TSC_CHANGED }] : []),
    ...testSteps(),
    ...fastGates(ownFolders, code),
    ...serverSteps(),
  ];
  return base;
}

/** The last line of a failed step's output that says what went wrong: an error line, else the last line. */
const lastErrorLine = (output: string): string => {
  const lines = output.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("check:"));
  return (lines.findLast((l) => /error|fail|timed out|killed/i.test(l)) ?? lines.at(-1) ?? "no output").trim().slice(0, 200);
};

/** Runs a step and keeps its output, which is printed only when the step fails: the steps run side by side. */
async function run(step: Step): Promise<{ code: number; failing: Failure[]; output: string }> {
  const p = Bun.spawn(step.cmd, { cwd: step.cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: step.cwd === "server" ? serverEnv : env });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, failing: [...parseFailures(out), ...parseFailures(err)], output: out + err };
}

// read again once the steps are through: the machine may have got busy while they ran
const measure = loadFactorMeter();
let factor = measure();
const started = performance.now();
const times: StepTime[] = [];
const outcome = new Map<string, Promise<boolean>>();

/** Runs one step after the steps it needs. Resolves to whether it passed; a step skipped for a failed need counts as failed. */
async function runStep(step: Step): Promise<boolean> {
  // every step is in the map before any looks for its needs, whatever their order in the plan
  await null;
  for (const need of step.needs ?? []) if (!(await outcome.get(need))) return false;
  const at = performance.now();
  const { code, failing, output } = await run(step);
  const isTests = step.name.startsWith("tests");
  const isServer = step.name === "server tests";
  let ok = code === 0;
  // a failed test is rerun alone: a flake in quarantine does not fail the step, a flake outside it or a failure alone does
  if (!ok && (isTests || isServer) && failing.length > 0) {
    const verdict = await judge(failing, (f) => runAlone(f, step.cwd, step.cwd === "server" ? serverEnv : env), readQuarantine(), isServer ? "server/" : "");
    for (const t of verdict.quarantined) console.log(`check: quarantined flake, passed alone: ${t}`);
    for (const t of verdict.flaky) {
      try {
        withQuarantined(readQuarantine(), t, "<fix task id>");
        console.error(`check: new flake, passed alone: ${t} (add {"test": "${t}", "task": "<fix task id>"} to test/quarantine.json)`);
      } catch (e) {
        console.error(`check: new flake, passed alone: ${t}: ${(e as Error).message}`);
      }
    }
    for (const t of verdict.broken) console.error(`check: failed alone too: ${t}`);
    ok = verdict.ok;
  }
  times.push({ step: step.name, seconds: (performance.now() - at) / 1000, ok });
  if (!ok) {
    console.error(
      `${output}\n${
        failing.length > 0
          ? `check: failing tests:\n${failing
              .slice(0, 20)
              .map((f) => `  ${describeFailure(f)}`)
              .join("\n")}${failing.length > 20 ? `\n  and ${failing.length - 20} more` : ""}\n`
          : ""
      }${
        isTests && touched && outsideChange(failing, touched) ? `${failing.map((f) => `check: outside the change: ${f.test}`).join("\n")}\n` : ""
      }check: ${step.name} failed${failing.length > 0 ? "" : `: ${lastErrorLine(output)}`}`,
    );
  }
  return ok;
}

/** `--shard=i/n`: the steps that stay whole go to the job `shardLoads` gave them; every job runs its tests and its part of the server's. */
function shardOf(all: Step[]): Step[] {
  if (!shard) return all;
  const { homes } = shardLoads(shard.n);
  const byName = new Map(all.map((s) => [s.name, s]));
  const keep = new Set(all.filter((s) => (homes.has(s.name) ? homes.get(s.name) === shard.i - 1 : true)).map((s) => s.name));
  const grow = (name: string) => {
    for (const need of byName.get(name)?.needs ?? []) {
      if (!keep.has(need)) {
        keep.add(need);
        grow(need);
      }
    }
  };
  for (const name of [...keep]) grow(name);
  return all.filter((s) => keep.has(s.name));
}
const sharded = shard !== undefined;
const plan = shardOf(steps());
for (const step of plan) outcome.set(step.name, runStep(step));
// every step runs even after one fails: one run names every failure, so no rerun is needed to find the next one, and
// `lineclear check` can tell a run that failed only on quarantined tests from one where another failed
const results = await Promise.all(plan.map((s) => outcome.get(s.name)));
const wall = (performance.now() - started) / 1000;
factor = measure();
let failed = results.some((ok) => !ok) ? 1 : 0;
if (recording && failed === 0 && !sharded) {
  const tests = allTests().map((f) => f.slice(2));
  saveMap(".", buildMap(loadDir, tests));
}

/** Test files and specs over their limits; the reports are read even when a step failed. */
function speed(): void {
  const baseline = readSlowBaseline();
  const read = (names: string[], parse: (t: string) => Times): Times => {
    const all: Times = new Map();
    for (const n of names) for (const [f, s] of parse(readFileSync(join(reports, n), "utf8"))) all.set(f, s);
    return all;
  };
  const unit = read(
    readdirSync(reports).filter((n) => n.startsWith("unit-")),
    junitTimes,
  );
  writeTimes(unit);
  // the log of a GitHub job shows which files cost the most, to cut or speed up
  console.log(
    `check: slowest test files\n${[...unit]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([f, sec]) => `  ${sec.toFixed(1)} s  ${f}`)
      .join("\n")}`,
  );
  // the unit limit is per test case: a file is judged by its slowest case
  const slowest = read(
    readdirSync(reports).filter((n) => n.startsWith("unit-")),
    junitSlowestCase,
  );
  if (lowering) {
    const next = lowered("unit", slowest, baseline, factor, adding);
    writeSlowBaseline(".", next);
    console.log("check: scripts/gates/baseline/slow.json lowered to the files over their limits");
    return;
  }
  const faults = [...slowFaults("unit", slowest, baseline, factor)];
  if (faults.length > 0 && !slowFails(faults, untimed)) {
    console.log(`check: --untimed, not failing on ${faults.length} slow file(s); the slowest: ${faults[0]}`);
  } else if (faults.length > 0) {
    console.error(
      `check: too slow, a test over 2 s (docs/numbers.md); the slowest first:\n${faults
        .slice(0, 8)
        .map((f) => `  ${f}`)
        .join("\n")}`,
    );
    failed ||= 1;
  }
}
speed();

console.log(`check${full ? " --full" : onlyChanged ? " --changed" : ""}: steps, slowest first (load factor ${factor.toFixed(2)})\n${table(times)}`);

// the budget is for the lane's run on a machine that is not busy; the full check has none
const slow = full || onlyChanged || lowering ? undefined : overBudget(times, wall, factor);
if (slow) {
  console.error(`check: ${slow}`);
  failed ||= 1;
}
if (failed !== 0) finish(failed);
console.log(`check: passed in ${wall.toFixed(0)} s (budget 180 s on a machine that is not busy)`);
finish(0);
