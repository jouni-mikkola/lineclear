import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir, readJson } from "../pi/config.ts";
import { type Settings, tiersOf } from "./project.ts";
import { bareLog, fullCheckWhy } from "./release.ts";

/** A run that started this long ago and left no result is taken as dead. */
const STALE_MS = 60 * 60_000;
const OUTPUT_TAIL = 4000;

/** One slow check that failed, with the end of its output. */
export interface Failure {
  name: string;
  output: string;
}

/** How a check runs: the end of its output when it fails, else undefined. */
export type Runner = (repo: string, command: string) => string | undefined;

const shellRun: Runner = (repo, command) => {
  const p = Bun.spawnSync(["sh", "-c", command], { cwd: repo, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30 * 60_000 });
  if (p.exitCode === null) return `timed out after 30 minutes\n${p.stdout}${p.stderr}`.slice(-OUTPUT_TAIL).trimEnd();
  return p.exitCode === 0 ? undefined : `${p.stdout}${p.stderr}`.slice(-OUTPUT_TAIL).trimEnd();
};

/** Runs the commands of a heavy tier and returns the ones that failed. The heavy run and a release share this. */
export function slowFailures(repo: string, commands: string[], run: Runner = shellRun): Failure[] {
  const failures: Failure[] = [];
  for (const name of commands) {
    const output = run(repo, name);
    if (output !== undefined) failures.push({ name, output });
  }
  return failures;
}

/** The title and brief of the task that fixes a failed heavy check. */
function fixTask(f: Failure, head: string): { title: string; brief: string } {
  return {
    title: `Fix heavy ${f.name.replace(/^\w+ run /, "")}`,
    brief: `The heavy check \`${f.name}\` failed on main at ${head}. Find the cause and fix it; do not turn the check off or raise a baseline.\n\nIts output (the end of it):\n\n\`\`\`\n${f.output}\n\`\`\`\n\nRun \`${f.name}\` and the project's check before you merge. Both must pass.\nWhen the fix works, rebase on main and merge it yourself. Do not ask first.`,
  };
}

/** A project's local heavy run, kept per project: the commit it started on and when. */
interface Run {
  head?: string;
  startedAt?: number;
  /** The commit whose red GitHub run has its fix task. */
  filed?: string;
}

type Env = Record<string, string | undefined>;

const runFile = (project: string, env: Env) => join(configDir(env), "projects", project, "heavy.json");
const resultFile = (project: string, env: Env) => join(configDir(env), "projects", project, "heavy-result.json");

/** What the rule loop needs to start a fix task. */
interface Tasks {
  now(): Date;
  addTask(space: string, title: string, brief: string, extra: string[]): string | undefined;
}

/** The workflow that runs the heavy suites on GitHub after each push to main: a repo with it needs no local run. */
export const HEAVY_WORKFLOW = join(".github", "workflows", "heavy.yml");

/** The newest finished heavy run on main when it is red: its commit and the end of its failed jobs' log. */
export interface RedRun {
  sha: string;
  log: string;
}

/** Reads GitHub for the red run on main; undefined when the newest finished run is green or GitHub did not answer. */
export type ReadRedRun = (repo: string) => RedRun | undefined;

const gh = (repo: string, args: string[]) => Bun.spawnSync(["gh", ...args], { cwd: repo, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 60_000 });

const readRedRun: ReadRedRun = (repo) => {
  const list = gh(repo, [
    "run",
    "list",
    "--workflow",
    "heavy.yml",
    "--branch",
    "main",
    "--event",
    "push",
    "--limit",
    "10",
    "--json",
    "databaseId,conclusion,headSha",
  ]);
  if (list.exitCode !== 0) return undefined;
  const runs = JSON.parse(String(list.stdout)) as { databaseId: number; conclusion: string; headSha: string }[];
  // a run still going or cancelled by a newer push says nothing about its commit
  const last = runs.find((r) => r.conclusion === "success" || r.conclusion === "failure");
  if (last?.conclusion !== "failure") return undefined;
  const log = gh(repo, ["run", "view", String(last.databaseId), "--log-failed"]);
  return { sha: last.headSha, log: String(log.stdout) };
};

/** The fix task of a red heavy run on main: the failing tests, as a red release check names them, and the end of the log. */
function redRunTask(r: RedRun): { title: string; brief: string } {
  const log = bareLog(r.log);
  return {
    title: `Fix heavy ${r.sha.slice(0, 7)}`,
    brief: `The heavy run on GitHub failed on main at ${r.sha.slice(0, 7)}: ${fullCheckWhy(log)}\n\nThe end of its log:\n\n\`\`\`\n${log.slice(-OUTPUT_TAIL).trim()}\n\`\`\`\n\nFind the cause and fix it; do not turn the check off or raise a baseline. Run the failing checks and the project's check before you merge. Both must pass.\nWhen the fix works, rebase on main and merge it yourself. Do not ask first.`,
  };
}

/** Runs `scripts/heavy.ts` on the repo in the background, so the slow checks never hold up a tick. */
function startRun(repo: string, out: string, commands: string[]): void {
  Bun.spawn([process.execPath, join(import.meta.dir, "..", "scripts", "heavy.ts"), "--out", out, ...commands], {
    cwd: repo,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  }).unref();
}

/**
 * The heavy run for one project, after a merge and never by the clock. A repo with the heavy workflow runs it on
 * GitHub: a tick files one fix task for the commit of a red run. Any other repo runs it here when main moved and no
 * run is going; a later tick reads its result and starts one fix task for each failure that has no open task yet.
 * A failure whose task would not start is read again.
 */
export function heavyTasks(
  project: string,
  settings: Settings,
  head: string,
  tasks: { title: string; status: string }[],
  world: Tasks,
  env: Env,
  note: (kind: "start" | "skip", reason: string) => void,
  start = startRun,
  redRun: ReadRedRun = readRedRun,
): void {
  if (head === "" || !existsSync(settings.repo)) return;
  const kept = (readJson(runFile(project, env)) as Run | undefined) ?? {};
  if (existsSync(join(settings.repo, HEAVY_WORKFLOW))) {
    let red: RedRun | undefined;
    try {
      red = redRun(settings.repo);
    } catch {
      // no gh, no network or an answer that is not JSON: the next tick asks again
      return;
    }
    if (red === undefined || red.sha === kept.filed) return;
    const t = redRunTask(red);
    if (tasks.some((x) => x.status !== "done" && x.title === t.title)) return;
    const err = world.addTask(settings.space, t.title, t.brief, []);
    if (err) {
      note("skip", `heavy run failed on ${red.sha.slice(0, 7)} and the fix task did not start: ${err}`);
      return;
    }
    writeAtomic(runFile(project, env), `${JSON.stringify({ ...kept, filed: red.sha })}\n`);
    note("start", `heavy run failed on ${red.sha.slice(0, 7)}, started a fix task`);
    return;
  }
  const result = resultFile(project, env);
  const failures = existsSync(result) ? (readJson(result) as Failure[]) : undefined;
  if (failures === undefined) {
    const going = kept.startedAt !== undefined && world.now().getTime() - kept.startedAt < STALE_MS;
    if (kept.head === head || going) return;
    const commands = tiersOf(settings).heavy.commands;
    if (commands.length === 0) return;
    writeAtomic(runFile(project, env), `${JSON.stringify({ ...kept, head, startedAt: world.now().getTime() })}\n`);
    start(settings.repo, result, commands);
    return;
  }
  writeAtomic(runFile(project, env), `${JSON.stringify({ ...kept, startedAt: undefined })}\n`);
  const left: Failure[] = [];
  for (const f of failures) {
    const ran = (kept.head ?? head).slice(0, 7);
    const t = fixTask(f, ran);
    if (tasks.some((x) => x.status !== "done" && x.title === t.title)) continue;
    const err = world.addTask(settings.space, t.title, t.brief, []);
    if (err) left.push(f);
    if (err) note("skip", `heavy ${f.name} failed and the fix task did not start: ${err}`);
    else note("start", `heavy ${f.name} failed on ${ran}, started a fix task`);
  }
  if (left.length > 0) writeAtomic(result, `${JSON.stringify(left)}\n`);
  else rmSync(result);
}
