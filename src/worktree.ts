import { existsSync } from "node:fs";
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
