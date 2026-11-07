// What a working task's row on Home shows: its last card, the files it changed and its check, and, once the row is
// opened, its log tail, diff stat, check output, review findings and cost. All from Lineclear's files, git, the check
// log and pi's session files, with no AI.
import { existsSync } from "node:fs";
import { type ChatFile, readChatLogs } from "./chat-kept.ts";
import { prChecks } from "./check-runs.ts";
import { readTasksKept } from "./tasks-kept.ts";
import { dataDir } from "./paths.ts";
import { gitText, gitWith } from "./git.ts";

/** A task folder's git output, trimmed; empty when git fails or hangs, so Home never waits on it. */
export const taskGit = (cwd: string, ...args: string[]) => {
  const r = gitWith({ timeout: 5000 }, cwd, ...args);
  return r.ok ? r.out.trim() : "";
};

type Env = Record<string, string | undefined>;

const LOG_LINES = 12;

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

/** GitHub's finished checks on the pull request of the branch checked out in `worktree`. */
const branchChecks = (worktree: string, now: number) => {
  const branch = gitText(worktree, "rev-parse", "--abbrev-ref", "HEAD");
  return branch ? prChecks(worktree, branch, now) : [];
};

export function taskFacts(t: TaskRef, now = Date.now()): TaskFacts {
  if (typeof t.worktree !== "string" || !existsSync(t.worktree)) return {};
  const out = taskGit(t.worktree, "diff", "--numstat", `${baseOf(t)}...HEAD`);
  const files = out ? out.trim().split("\n").filter(Boolean).length : 0;
  const run = branchChecks(t.worktree, now).at(-1);
  return { files, ...(run ? { check: run.ok ? ("pass" as const) : ("fail" as const) } : {}) };
}

/** What a row shows besides the task itself: its last card, and for a started task its files and check. */
export function rowFacts(t: TaskRef, last: { text: string; at: number } | undefined, started: boolean, now: number) {
  return { ...(last ? { last } : {}), ...(started ? taskFacts(t, now) : {}) };
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

const cardTexts = (chat: ChatFile | undefined, task?: string) => {
  const posted: { at?: unknown; card?: { text?: unknown; task?: string } }[] = chat?.log.posted ?? [];
  return posted
    .filter((p) => typeof p?.at === "number" && typeof p.card?.text === "string" && (task === undefined || p.card.task === task))
    .sort((a, b) => Number(a.at) - Number(b.at))
    .map((p) => String(p.card?.text));
};

/** What the caller brings: Lineclear's folder and a pricer of a worktree's sessions. */
export interface TaskSources {
  lineclear: string;
  costSoFar: (worktree: string) => number | undefined;
}

/**
 * A task's opened row, or undefined for an id this machine has no task of. `lineclear` is Lineclear's folder and
 * `costSoFar` prices a worktree's sessions; the caller brings both, as measure.ts sits in a cycle this file stays out of.
 */
export function taskDetail(id: string, from: TaskSources, env: Env = process.env, now = Date.now()): TaskDetail | undefined {
  const t = readTasksKept(from.lineclear).tasks.find((x) => x.id === id) as TaskRef | undefined;
  if (!t) return undefined;
  const chats = readChatLogs(dataDir(env));
  const log = cardTexts(
    chats.find((c) => c.name === `${id}_Agent`),
    id,
  ).slice(-LOG_LINES);
  const review = cardTexts(chats.find((c) => c.name === `${id}_Reviewer`));
  const worktree = typeof t.worktree === "string" && existsSync(t.worktree) ? t.worktree : undefined;
  const diff = worktree ? taskGit(worktree, "diff", "--stat", `${baseOf(t)}...HEAD`) : "";
  const run = worktree ? branchChecks(worktree, now).at(-1) : undefined;
  const cost = worktree ? from.costSoFar(worktree) : undefined;
  return {
    log,
    diff,
    ...(run ? { check: { ok: run.ok, command: run.name, seconds: run.seconds, at: run.at, failed: run.ok ? [] : [run.name] } } : {}),
    review,
    ...(cost !== undefined ? { cost } : {}),
  };
}

export function taskDetailReply(id: string, from: TaskSources, env: Env, now: number, json: (body: unknown, status?: number) => Response): Response {
  const detail = taskDetail(decodeURIComponent(id), from, env, now);
  return detail ? json(detail) : json({ error: "No such task on this machine." }, 404);
}
