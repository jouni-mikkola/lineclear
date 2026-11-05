import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir, readJson } from "../pi/config.ts";
import { type Settings, tiersOf } from "./project.ts";

/** Hour of the day (local) from which the night's run is due. */
const NIGHTLY_HOUR = 3;
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

/** Runs the commands of a nightly tier and returns the ones that failed. The nightly job and a release share this. */
export function slowFailures(repo: string, commands: string[], run: Runner = shellRun): Failure[] {
  const failures: Failure[] = [];
  for (const name of commands) {
    const output = run(repo, name);
    if (output !== undefined) failures.push({ name, output });
  }
  return failures;
}

/** The night's run is due when it is past the hour and has not started today (`day` is the local date of the last run). */
export function nightlyDue(day: string | undefined, now: Date): boolean {
  return now.getHours() >= NIGHTLY_HOUR && day !== localDay(now);
}

const localDay = (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** The title and brief of the task that fixes a failed slow check. */
function fixTask(f: Failure, head: string): { title: string; brief: string } {
  return {
    title: `Fix nightly ${f.name.replace(/^\w+ run /, "")}`,
    brief: `The nightly check \`${f.name}\` failed on main at ${head}. Find the cause and fix it; do not turn the check off or raise a baseline.\n\nIts output (the end of it):\n\n\`\`\`\n${f.output}\n\`\`\`\n\nRun \`${f.name}\` and the project's check before you merge. Both must pass.\nWhen the fix works, rebase on main and merge it yourself. Do not ask first.`,
  };
}

/** A night's run, kept per project: the day it started. */
interface Night {
  day?: string;
  /** The commit the run started on: the fix task names it, not a later tick's head. */
  head?: string;
}

type Env = Record<string, string | undefined>;

const nightFile = (project: string, env: Env) => join(configDir(env), "projects", project, "nightly.json");
const resultFile = (project: string, env: Env) => join(configDir(env), "projects", project, "nightly-result.json");

/** What the rule loop needs to start a fix task. */
interface Tasks {
  now(): Date;
  addTask(space: string, title: string, brief: string, extra: string[]): string | undefined;
}

/** Runs `scripts/nightly.ts` on the repo in the background, so the slow checks never hold up a tick. */
function startRun(repo: string, out: string, commands: string[]): void {
  Bun.spawn([process.execPath, join(import.meta.dir, "..", "scripts", "nightly.ts"), "--out", out, ...commands], {
    cwd: repo,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  }).unref();
}

/**
 * The night's run for one project. A tick starts it once a day when it is due; a later tick reads its result and
 * starts one fix task for each failure that has no open task yet. A failure whose task would not start is read again.
 */
export function nightlyTasks(
  project: string,
  settings: Settings,
  head: string,
  tasks: { title: string; status: string }[],
  world: Tasks,
  env: Env,
  note: (kind: "start" | "skip", reason: string) => void,
  start = startRun,
): void {
  const now = world.now();
  const night = (readJson(nightFile(project, env)) as Night | undefined) ?? {};
  const result = resultFile(project, env);
  const failures = existsSync(result) ? (readJson(result) as Failure[]) : undefined;
  if (failures === undefined) {
    if (head === "" || !existsSync(settings.repo) || !nightlyDue(night.day, now)) return;
    const commands = tiersOf(settings).nightly.commands;
    if (commands.length === 0) return;
    writeAtomic(nightFile(project, env), `${JSON.stringify({ day: localDay(now), head })}\n`);
    start(settings.repo, result, commands);
    return;
  }
  const left: Failure[] = [];
  for (const f of failures) {
    const ran = (night.head ?? head).slice(0, 7);
    const t = fixTask(f, ran);
    if (tasks.some((x) => x.status !== "done" && x.title === t.title)) continue;
    const err = world.addTask(settings.space, t.title, t.brief, []);
    if (err) left.push(f);
    if (err) note("skip", `nightly ${f.name} failed and the fix task did not start: ${err}`);
    else note("start", `nightly ${f.name} failed on ${ran}, started a fix task`);
  }
  if (left.length > 0) writeAtomic(result, `${JSON.stringify(left)}\n`);
  else rmSync(result);
}
