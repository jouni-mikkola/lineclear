import { openSync, readSync, closeSync } from "node:fs";
import type { TaskInfo } from "./measure.ts";
import { piHarness } from "./harness-pi.ts";

type Env = Record<string, string | undefined>;

/** The first 400 bytes of a file: its session line, which holds the start time and the folder. */
function head(file: string): string {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(400);
    return buf.toString("utf8", 0, readSync(fd, buf, 0, 400, 0));
  } finally {
    closeSync(fd);
  }
}

/**
 * Tasks found from pi's session files, for work whose task record is gone from the store (a store moved, or work on
 * an install whose store this one does not read): one per working folder `<repo>/work-<n>-<slug>`. A slug that starts
 * with a step id (`l57-...`) names the step, so the task counts for its wait and its cost. Folders in `known` have a record.
 */
export function tasksFromSessions(env: Env, repoName: string, known: Set<string>): TaskInfo[] {
  const found: TaskInfo[] = [];
  for (const { name, files } of piHarness.allSessionFolders(env)) {
    if (!name.includes(`-worktrees-${repoName}-work-`)) continue;
    const first = files[0];
    if (!first) continue;
    const line = head(first);
    const worktree = /"cwd":"([^"]+)"/.exec(line)?.[1] ?? "";
    const at = Date.parse(/"timestamp":"([^"]+)"/.exec(line)?.[1] ?? "");
    const m = new RegExp(`/${repoName}/work-(\\d+)-([a-z]+\\d+)-`).exec(worktree);
    if (!m || Number.isNaN(at) || known.has(worktree)) continue;
    found.push({ id: `session:${m[1]}`, title: `${(m[2] as string).toUpperCase()} work found in its sessions`, start: at, worktree });
  }
  return found;
}
