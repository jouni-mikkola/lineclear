import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { readTasksKept } from "./kept-read.ts";
import { dataDir } from "./paths.ts";
import { DAY } from "./time.ts";
import { removeFolders } from "./tmpdirs.ts";

type Env = Record<string, string | undefined>;

/** Folders of the data folder that belong to features that are gone. */
const DELETED_FEATURES = ["autopilot-runtime"];

/** A worktree no task owns is left alone for this long before it goes: a start may be making it. */
const ORPHAN_AGE_MS = 7 * DAY;

/** A retired task's work is kept on its branch, so its worktree goes after this long. */
const RETIRED_AGE_MS = DAY;

const isOurs = (name: string) => name.startsWith("work-");

/** Removes a worktree folder, then tells its repo to forget it (the repo is named in the folder's `.git` file). */
function removeWorktree(path: string): void {
  let gitDir = "";
  try {
    gitDir = readFileSync(join(path, ".git"), "utf8").match(/^gitdir: (.+)\/worktrees\/[^/\n]+$/m)?.[1] ?? "";
  } catch {
    // not a linked worktree
  }
  removeFolders([path]);
  rmSync(path, { recursive: true, force: true });
  if (gitDir) spawnSync("git", [`--git-dir=${gitDir}`, "worktree", "prune"], { stdio: "ignore" });
}

/** The loop's sweep of disk use: worktrees of ended tasks, work folders no task owns, and the data of deleted features. Returns what to log. */
export function sweepDiskUse(now: Date, env: Env = process.env): string[] {
  const lines: string[] = [];
  const dir = dataDir(env);
  for (const name of DELETED_FEATURES) {
    if (!existsSync(join(dir, name))) continue;
    rmSync(join(dir, name), { recursive: true, force: true });
    lines.push(`removed ${name} from the data folder: its feature is gone`);
  }
  const tasks = readTasksKept(dir).tasks;
  const owned = new Set<string>();
  let retired = 0;
  for (const t of tasks) {
    const wt = typeof t.worktree === "string" ? t.worktree : "";
    if (!wt) continue;
    const doneAt = Number(t.doneAt ?? t.updated ?? 0);
    const ended = !!(t.merged || t.closed);
    if (ended && !t.pinned && now.getTime() - doneAt >= RETIRED_AGE_MS) {
      if (existsSync(wt)) {
        removeWorktree(wt);
        retired++;
      }
    } else owned.add(wt);
  }
  if (retired) lines.push(`removed ${retired} worktree${retired === 1 ? "" : "s"} of retired tasks`);
  // the folders worktrees live in are read from the tasks themselves
  const roots = new Set([...owned, ...tasks.map((t) => (typeof t.worktree === "string" ? t.worktree : ""))].filter(Boolean).map((w) => dirname(w)));
  let orphans = 0;
  for (const root of roots) {
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const n of names) {
      const path = join(root, n);
      if (!isOurs(n) || owned.has(path)) continue;
      try {
        if (now.getTime() - statSync(path).mtimeMs < ORPHAN_AGE_MS) continue;
      } catch {
        continue;
      }
      removeWorktree(path);
      orphans++;
    }
  }
  if (orphans) lines.push(`removed ${orphans} old work folder${orphans === 1 ? "" : "s"} no task owns`);
  return lines;
}
