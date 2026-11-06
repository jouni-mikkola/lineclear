import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "../pi/config.ts";

/** The fields of a Lineclear task that these checks read. */
interface Task {
  id?: string;
  worktree?: string;
  base?: string;
}

function taskOf(task: string, tasksFile: string): Task | undefined {
  const tasks: Task[] | undefined = readJson(tasksFile)?.tasks;
  return (Array.isArray(tasks) ? tasks : []).find((t) => t?.id === task);
}

/** The worktree of a task as Lineclear's task list holds it, or undefined. */
export function taskWorktree(task: string, tasksFile: string): string | undefined {
  const worktree = taskOf(task, tasksFile)?.worktree;
  return typeof worktree === "string" ? worktree : undefined;
}

/**
 * The task's agent log holds a user message after `since` that Lineclear did not send (its lines start with
 * `<lineclear>`) and Lineclear did not (`[lineclear]`, `[lineclear:kind]`, `[lineclear notes]`).
 * The log is the agent's pi session folder of the task's worktree.
 */
export function ownerWrote(task: string, since: string, tasksFile: string, sessionsOf: (worktree: string) => string): boolean {
  const worktree = taskWorktree(task, tasksFile);
  const folder = worktree ? sessionsOf(worktree) : undefined;
  if (folder === undefined || !existsSync(folder)) return false;
  const from = new Date(since).getTime();
  return readdirSync(folder).some(
    (f) =>
      f.endsWith(".jsonl") &&
      readFileSync(join(folder, f), "utf8")
        .split("\n")
        .some((line) => {
          try {
            const e = JSON.parse(line);
            if (e?.message?.role !== "user" || new Date(e.timestamp).getTime() <= from) return false;
            const c = e.message.content;
            const text = typeof c === "string" ? c : (c ?? []).map((x: { text?: string }) => x?.text ?? "").join("");
            return !/^(<lineclear>|\[lineclear[\]: ])/.test(text.trimStart());
          } catch {
            return false;
          }
        }),
  );
}

/** The task's worktree has nothing to merge: no uncommitted change and no commit beyond its base. False when it cannot tell. */
export function worktreeClean(task: string, run: (cmd: string[], cwd?: string) => { code: number; out: string }, tasksFile: string): boolean {
  const t = taskOf(task, tasksFile);
  if (typeof t?.worktree !== "string" || !existsSync(t.worktree)) return false;
  const status = run(["git", "-C", t.worktree, "status", "--porcelain"]);
  if (status.code !== 0 || status.out.trim() !== "") return false;
  const base = typeof t.base === "string" && t.base ? t.base : "main";
  for (const b of [base, `origin/${base}`]) {
    const ahead = run(["git", "-C", t.worktree, "rev-list", "--count", `${b}..HEAD`]);
    if (ahead.code === 0) return Number(ahead.out.trim()) === 0;
  }
  return false;
}

/** A branch's commits that main lacks; one that cannot be read is taken to hold work. */
export function commitsAhead(run: (cmd: string[]) => { code: number | null; out: string }, repo: string, branch: string): number {
  const r = run(["git", "-C", repo, "rev-list", "--count", `main..${branch}`]);
  return r.code === 0 ? Number(r.out.trim()) : 1;
}

/** Pushes a branch to origin, so a task moved to another machine finds its work there. Returns an error text, or undefined. */
export function pushBranch(run: (cmd: string[]) => { code: number | null; out: string; err: string }, repo: string, branch: string): string | undefined {
  const r = run(["git", "-C", repo, "push", "origin", `${branch}:refs/heads/${branch}`]);
  return r.code === 0 ? undefined : (r.err || r.out).trim() || `exit ${r.code}`;
}
