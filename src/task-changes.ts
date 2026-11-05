// A task's changes for review, read only: its branch's diff against its base, file by file, and its pull request.
// From git and `gh` in the task's worktree, with no AI.
import { existsSync } from "node:fs";
import { readTasksKept } from "./kept-read.ts";
import { baseOf, git } from "./task-detail.ts";

const MAX_FILES = 80;
const MAX_LINES = 400;

export interface ChangedFile {
  path: string;
  added: number;
  removed: number;
  /** The unified diff lines from the first hunk on, cut at `MAX_LINES`. */
  lines: string[];
  /** Lines left out of `lines`. */
  cut: number;
  binary?: true;
}

export interface TaskChanges {
  base: string;
  files: ChangedFile[];
  /** Files beyond `MAX_FILES`, which are not listed. */
  more: number;
  pr?: { number: number; url: string; state: string; title: string };
}

/** The files of one `git diff` output: each starts at its `diff --git` line. */
export function parseDiff(out: string): { files: ChangedFile[]; more: number } {
  const all: ChangedFile[] = [];
  for (const block of out.split(/^diff --git /m).slice(1)) {
    const rows = block.split("\n");
    if (rows.at(-1) === "") rows.pop();
    const path = /^a\/(.+) b\/(.+)$/.exec(rows[0] ?? "")?.[2] ?? rows[0] ?? "";
    const at = rows.findIndex((r) => r.startsWith("@@"));
    const body = at < 0 ? [] : rows.slice(at);
    all.push({
      path,
      added: body.filter((r) => r.startsWith("+")).length,
      removed: body.filter((r) => r.startsWith("-")).length,
      lines: body.slice(0, MAX_LINES),
      cut: Math.max(0, body.length - MAX_LINES),
      ...(at < 0 && rows.some((r) => r.startsWith("Binary files")) ? { binary: true as const } : {}),
    });
  }
  return { files: all.slice(0, MAX_FILES), more: Math.max(0, all.length - MAX_FILES) };
}

function pullRequest(worktree: string): TaskChanges["pr"] {
  const p = Bun.spawnSync(["gh", "pr", "view", "--json", "number,url,state,title"], { cwd: worktree, stdin: "ignore", stderr: "ignore", timeout: 8000 });
  if (p.exitCode !== 0) return undefined;
  try {
    const j = JSON.parse(p.stdout.toString());
    return typeof j?.url === "string" ? { number: Number(j.number), url: j.url, state: String(j.state ?? ""), title: String(j.title ?? "") } : undefined;
  } catch {
    return undefined;
  }
}

/** The task's changes, or undefined for an id this machine has no worktree of. */
export function taskChanges(id: string, shepherdr: string, withPr = true): TaskChanges | undefined {
  const t = readTasksKept(shepherdr).tasks.find((x) => x.id === id) as { base?: unknown; worktree?: unknown } | undefined;
  if (!t || typeof t.worktree !== "string" || !existsSync(t.worktree)) return undefined;
  const base = baseOf(t);
  const pr = withPr ? pullRequest(t.worktree) : undefined;
  return { base, ...parseDiff(git(t.worktree, "diff", "--no-color", "--no-ext-diff", `${base}...HEAD`)), ...(pr ? { pr } : {}) };
}

export const changesReply = (id: string, shepherdr: string, json: (body: unknown, status?: number) => Response): Response => {
  const read = taskChanges(id, shepherdr);
  return read ? json(read) : json({ error: "This task has no worktree on this machine." }, 404);
};
