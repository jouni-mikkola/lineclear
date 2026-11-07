import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
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

/** A retired task's worktree goes after this long; what it committed stays on its branch. */
const RETIRED_AGE_MS = DAY;

const isOurs = (name: string) => name.startsWith("work-");

/** Uncommitted work is the one thing a removed worktree loses; a folder git cannot read counts as holding some. */
const hasUncommitted = (path: string): boolean => {
  const r = spawnSync("git", ["-C", path, "status", "--porcelain"], { encoding: "utf8" });
  return r.status !== 0 || r.stdout.trim() !== "";
};

const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** Removes a worktree folder, then tells its repo to forget it (the repo is named in the folder's `.git` file). */
function removeWorktree(path: string): void {
  let gitDir = "";
  try {
    gitDir = readFileSync(join(path, ".git"), "utf8").match(/^gitdir: (.+)\/worktrees\/[^/\n]+$/m)?.[1] ?? "";
  } catch {
    // not a linked worktree
  }
  removeFolders([path]);
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
    owned.add(real(wt));
    if (ended && !t.pinned && now.getTime() - doneAt >= RETIRED_AGE_MS && existsSync(wt) && !hasUncommitted(wt)) {
      removeWorktree(wt);
      retired++;
    }
  }
  if (retired) lines.push(`removed ${retired} worktree${retired === 1 ? "" : "s"} of retired tasks`);
  // the folders worktrees live in are read from the tasks, so no path is fixed here. A folder a task still names is never an orphan, ended or not
  const roots = new Set(
    tasks
      .map((t) => (typeof t.worktree === "string" ? t.worktree : ""))
      .filter(Boolean)
      .map((w) => dirname(w)),
  );
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
      if (!isOurs(n) || owned.has(real(path))) continue;
      try {
        if (now.getTime() - statSync(path).mtimeMs < ORPHAN_AGE_MS) continue;
      } catch {
        continue;
      }
      if (hasUncommitted(path)) continue;
      removeWorktree(path);
      orphans++;
    }
  }
  if (orphans) lines.push(`removed ${orphans} old work folder${orphans === 1 ? "" : "s"} no task owns`);
  return lines;
}
