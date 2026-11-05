// What a working task's row on Home shows: its last card, the files it changed and its check, and, once the row is
// opened, its log tail, diff stat, check output, review findings and cost. All from Shepherdr's files, git, the check
// log and pi's session files, with no AI.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readRuns, whereRun } from "./check-runs.ts";
import { readTasksKept } from "./kept-read.ts";
import { dataDir } from "./paths.ts";

type Env = Record<string, string | undefined>;

const DAY = 86_400_000;
const LOG_LINES = 12;

export const git = (cwd: string, ...args: string[]) => {
  const p = Bun.spawnSync(["git", "-C", cwd, ...args], { stdin: "ignore", stderr: "ignore", timeout: 5000 });
  return p.exitCode === 0 ? p.stdout.toString() : "";
};

export interface TaskFacts {
  /** How many files its branch changed against its base. */
  files?: number;
  /** The result of the last check run on its branch. */
  check?: "pass" | "fail";
}

interface TaskRef {
  base?: unknown;
  worktree?: unknown;
}

/** The branch's own base: what a diff and a check of the task are read against. */
export const baseOf = (t: TaskRef) => (typeof t.base === "string" && t.base ? t.base : "main");

export function taskFacts(t: TaskRef, env: Env = process.env, now = Date.now()): TaskFacts {
  if (typeof t.worktree !== "string" || !existsSync(t.worktree)) return {};
  const out = git(t.worktree, "diff", "--numstat", `${baseOf(t)}...HEAD`);
  const files = out ? out.trim().split("\n").filter(Boolean).length : 0;
  const where = whereRun(t.worktree);
  const run = readRuns(where.repo, now - 7 * DAY, env as NodeJS.ProcessEnv)
    .filter((r) => r.branch === where.branch)
    .at(-1);
  return { files, ...(run ? { check: run.ok ? ("pass" as const) : ("fail" as const) } : {}) };
}

/** What a row shows besides the task itself: its last card, and for a started task its files and check. */
export function rowFacts(t: TaskRef, last: { text: string; at: number } | undefined, started: boolean, env: Env, now: number) {
  return { ...(last ? { last } : {}), ...(started ? taskFacts(t, env, now) : {}) };
}

export interface TaskDetail {
  /** The last cards of the task's chat, oldest first. */
  log: string[];
  /** `git diff --stat` of its branch against its base. */
  diff: string;
  check?: { ok: boolean; command: string; seconds: number; at: number; failed: string[] };
  /** What its reviewer posted, oldest first. */
  review: string[];
  /** The equivalent dollars of the task's pi sessions so far. */
  cost?: number;
}

const cardTexts = (file: string, task?: string) => {
  try {
    const posted: { at?: unknown; card?: { text?: unknown; task?: string } }[] = JSON.parse(readFileSync(file, "utf8"))?.posted ?? [];
    return posted
      .filter((p) => typeof p?.at === "number" && typeof p.card?.text === "string" && (task === undefined || p.card.task === task))
      .sort((a, b) => Number(a.at) - Number(b.at))
      .map((p) => String(p.card?.text));
  } catch {
    return [];
  }
};

/** What the caller brings: Shepherdr's folder and a pricer of a worktree's sessions. */
export interface TaskSources {
  shepherdr: string;
  costSoFar: (worktree: string) => number | undefined;
}

/**
 * A task's opened row, or undefined for an id this machine has no task of. `shepherdr` is Shepherdr's folder and
 * `costSoFar` prices a worktree's sessions; the caller brings both, as measure.ts sits in a cycle this file stays out of.
 */
export function taskDetail(id: string, from: TaskSources, env: Env = process.env, now = Date.now()): TaskDetail | undefined {
  const t = readTasksKept(from.shepherdr).tasks.find((x) => x.id === id) as TaskRef | undefined;
  if (!t) return undefined;
  const chats = join(dataDir(env), "chatlog");
  const files = existsSync(chats) ? readdirSync(chats) : [];
  const log = files
    .filter((f) => f === `${id}_Agent.json`)
    .flatMap((f) => cardTexts(join(chats, f), id))
    .slice(-LOG_LINES);
  const review = files.filter((f) => f === `${id}_Reviewer.json`).flatMap((f) => cardTexts(join(chats, f)));
  const worktree = typeof t.worktree === "string" && existsSync(t.worktree) ? t.worktree : undefined;
  const diff = worktree ? git(worktree, "diff", "--stat", `${baseOf(t)}...HEAD`).trim() : "";
  const where = worktree ? whereRun(worktree) : undefined;
  const run =
    where &&
    readRuns(where.repo, now - 7 * DAY, env as NodeJS.ProcessEnv)
      .filter((r) => r.branch === where.branch)
      .at(-1);
  const cost = worktree ? from.costSoFar(worktree) : undefined;
  return {
    log,
    diff,
    ...(run ? { check: { ok: run.ok, command: run.command, seconds: run.seconds, at: run.at, failed: run.failed } } : {}),
    review,
    ...(cost !== undefined ? { cost } : {}),
  };
}

export function taskDetailReply(id: string, from: TaskSources, env: Env, now: number, json: (body: unknown, status?: number) => Response): Response {
  const detail = taskDetail(decodeURIComponent(id), from, env, now);
  return detail ? json(detail) : json({ error: "No such task on this machine." }, 404);
}
