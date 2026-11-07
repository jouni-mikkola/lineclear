import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { taskWorktree } from "./worktree.ts";

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
