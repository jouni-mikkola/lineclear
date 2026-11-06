// `lineclear check`: a tier's commands in turn, each run recorded in the check log with its time and the load at the
// time. A run that fails only on quarantined tests counts as passed. A tier over its budget on an idle machine is a
// fault of the check, not of the change: it is said, the rule loop files the fix, and the run's own verdict stands.
import { spawnSync } from "node:child_process";
import { serverBin } from "./paths.ts";
import {
  failedGate,
  failureCauses,
  infraField,
  flakeFixDue,
  failedOutside,
  failedTests,
  loadMeter,
  onlyQuarantined,
  quarantined,
  quarantineReport,
  readRuns,
  recordFixFiled,
  recordBudgetFault,
  runLog,
  recordRun,
  releaseTest,
  sameCommand,
  splitKey,
  type Tier,
  whereRun,
  worthRerun,
} from "./check-runs.ts";
import { type Settings, tierNames, tiersOf } from "./project.ts";

interface FlakyTest {
  file: string;
  test: string;
}

/** Files the fix task of a flaky test in a space. True when it is filed. */
export type FileFlakeFix = (space: string, f: FlakyTest, seen: number) => boolean;

/** The fix task of a flaky test, the same for the repo check (scripts/flaky.ts) and `lineclear check`. */
export const flakeFixIn =
  (world: { addTask(space: string, title: string, brief: string, extra: string[]): string | undefined }): FileFlakeFix =>
  (space, f, seen) => {
    const where = f.file === "" ? "" : ` in ${f.file}`;
    const brief = `The test "${f.test}"${where} flaked ${seen} times in 24 hours (class 'flaky test'). Find what it waits on or shares with other runs at the cause, remove it, and run the test under load.`;
    return world.addTask(space, `Fix flaky ${f.test}`, brief, []) === undefined;
  };

/** Adds a task through the server's command; the real world cannot be imported here without a cycle. Undefined when it worked. */
function addTaskBySpawn(space: string, title: string, brief: string, env: NodeJS.ProcessEnv): string | undefined {
  const p = spawnSync(serverBin(env), ["task", "add", title.slice(0, TITLE_MAX), "--brief", brief, "--space", space], { env, stdio: "ignore" });
  return p.status === 0 ? undefined : "the task was not added";
}

/** Runs one command of a tier in its turn and returns its exit code; `hear` gets its output as it comes. */
type RunOne = (command: string, tier: Tier, hear: (text: string) => void, waited: (ms: number) => void) => Promise<number>;

const TITLE_MAX = 32;

/** The most output kept to read the failed tests from: their names come at the end. */
const KEEP_CHARS = 2_000_000;

/** Two failures of one command on one commit with no edits: a third run would only try to get past a flake. */
function failedTwice(repo: string, command: string, commit: string, env: NodeJS.ProcessEnv): boolean {
  let failures = 0;
  for (const r of readRuns(repo, 0, env)) {
    if (sameCommand(r.command) !== sameCommand(command) || r.commit !== commit || r.dirty) continue;
    failures = r.ok || r.quarantined ? 0 : failures + 1;
  }
  return failures >= 2;
}

async function runRecorded(
  command: string,
  tier: Tier,
  settings: Settings,
  group: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  out: (l: string) => void,
  runOne: RunOne,
  readLoad?: () => number[],
  clock: () => number = () => performance.now(),
  rerun = false,
  fileFix?: FileFlakeFix,
): Promise<{ code: number; seconds: number; idle: boolean }> {
  const where = whereRun(cwd, env);
  if (!where.dirty && where.commit && failedTwice(settings.repo, command, where.commit, env)) {
    out(`lineclear check: '${command}' failed twice on this commit: a third run only gets past a flake. Fix the failure, then commit and check again.`);
    return { code: 1, seconds: 0, idle: true };
  }
  const meter = loadMeter(readLoad);
  const started = clock();
  let output = "";
  let waitedMs = 0;
  const code = await runOne(
    command,
    tier,
    (text) => {
      output = (output + text).slice(-KEEP_CHARS);
    },
    (ms) => {
      waitedMs = ms;
    },
  );
  const seconds = (clock() - started) / 1000;
  const { load, loadAtStart, cores } = meter();
  const failed = code === 0 ? [] : failedTests(output);
  const outside = code === 0 ? [] : failedOutside(output);
  const gate = code === 0 ? undefined : failedGate(output);
  const before = quarantined(settings.repo, env);
  const passes = code !== 0 && onlyQuarantined(command, output, code, failed, before);
  // a timeout, a kill or a loaded machine says nothing about the change: a merge run that names no test or gate gets one more try
  const again = tier === "merge" && !rerun && code !== 0 && !passes && worthRerun({ failed, gate, load, cores });
  recordRun(
    {
      at: Date.now(),
      ...where,
      repo: settings.repo,
      tier,
      command,
      seconds,
      slotWaitMin: waitedMs / 60_000,
      load,
      loadAtStart,
      cores,
      ok: code === 0,
      failed,
      ...(code === 0 ? {} : { causes: failureCauses(output, code, failed, gate) }),
      ...(code === 0 ? {} : infraField(output, code)),
      ...(gate ? { gate } : {}),
      ...(outside.length > 0 ? { outside } : {}),
      ...(passes ? { quarantined: true } : {}),
      ...(again ? { rerun: true } : {}),
      group,
    },
    env,
  );
  const flaky = [...quarantined(settings.repo, env).keys()].filter((t) => !before.has(t));
  if (flaky.length > 0)
    out(
      `lineclear check: flaky, in quarantine now (failed, then passed on this commit): ${flaky.join(", ")}. It no longer blocks a merge, and the rule loop files its fix.`,
    );
  const file = fileFix ?? flakeFixIn({ addTask: (space, title, brief) => addTaskBySpawn(space, title, brief, env) });
  for (const { test, seen } of flakeFixDue(settings.repo, env)) if (file(settings.space, splitKey(test), seen)) recordFixFiled(settings.repo, test, env);
  if (passes) out(`lineclear check: only tests in quarantine failed (${failed.join(", ")}), so it counts as passed`);
  if (again) {
    out(`lineclear check: '${command}' failed with no named test or gate, rerun once`);
    return runRecorded(command, tier, settings, group, cwd, env, out, runOne, readLoad, clock, true, fileFix);
  }
  if (rerun && code !== 0 && !passes && !gate && failed.length === 0) out("lineclear check: held, cause unnamed: it failed twice and named no test or gate");
  return { code: passes ? 0 : code, seconds, idle: load < cores / 2 };
}

export async function checkTier(
  args: string[],
  settings: Settings,
  out: (l: string) => void,
  env: NodeJS.ProcessEnv,
  cwd: string,
  runOne: RunOne,
  readLoad?: () => number[],
  clock?: () => number,
  fileFix?: FileFlakeFix,
): Promise<number> {
  const say = (line: string, code: number) => {
    out(line);
    return code;
  };
  const usage = () =>
    say("usage: lineclear check [--changed] [--tier inner|merge|heavy] [command] | lineclear check --release <test> | lineclear check --log", 2);
  if (args[0] === "--log") {
    if (args.length !== 1) return usage();
    for (const line of runLog(settings.repo, env)) out(line);
    return 0;
  }
  if (args[0] === "--release") {
    const test = args[1];
    if (test === undefined || args.length !== 2) return usage();
    if (!quarantined(settings.repo, env).has(test)) return say(`lineclear check: '${test}' is not in quarantine`, 1);
    releaseTest(settings.repo, test, env);
    return say(`released from quarantine: ${test}; it blocks merges again`, 0);
  }
  const at = args.indexOf("--tier");
  const named = at >= 0 ? args[at + 1] : undefined;
  const rest = at >= 0 ? args.filter((_, i) => i !== at && i !== at + 1) : args;
  if ((at >= 0 && !(tierNames as readonly string[]).includes(named ?? "")) || rest.length > 1 || rest.some((a) => a.startsWith("--"))) return usage();
  const tiers = tiersOf(settings);
  const given = rest[0];
  const tier = (named as Tier | undefined) ?? (given === undefined ? "merge" : (tierNames.find((t) => tiers[t].commands.includes(given)) ?? "merge"));
  const commands = given === undefined ? tiers[tier].commands : [given];
  if (commands.length === 0) return say(`lineclear check: the ${tier} tier has no commands, see 'lineclear project list'`, 0);
  const group = `${process.pid}-${Date.now()}`;
  let total = 0;
  let idle = true;
  let code = 0;
  // each command runs, so a flake in one never hides the others and quarantine reaches every command of a chain
  for (const command of commands) {
    const r = await runRecorded(command, tier, settings, group, cwd, env, out, runOne, readLoad, clock, false, fileFix);
    total += r.seconds;
    idle &&= r.idle;
    if (r.code !== 0 && code === 0) code = r.code;
  }
  for (const line of quarantineReport(settings.repo, env)) out(line);
  if (code !== 0) return code;
  const budget = tiers[tier].budgetS;
  if (given === undefined && total > budget) {
    if (idle) recordBudgetFault({ at: Date.now(), repo: settings.repo, tier, limitS: budget, seconds: total }, env);
    out(
      idle
        ? `lineclear check: the ${tier} tier took ${total.toFixed(0)} s, over its budget of ${budget} s on an idle machine: a fault of the check, not of the change. This run still passes.`
        : `lineclear check: the ${tier} tier took ${total.toFixed(0)} s, over its budget of ${budget} s, on a busy machine: not counted`,
    );
  }
  return 0;
}
