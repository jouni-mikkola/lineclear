import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { piDir } from "./paths.ts";

/** pi keeps a folder of sessions per working folder: its path with `/` as `-`, between `--`. */
export function sessionFolder(worktree: string): string {
  return `--${worktree.replace(/^\//, "").replace(/\//g, "-")}--`;
}

export const sessionsRoot = (home: string) => join(home, "sessions");

/** The `.jsonl` files of a folder, by name; none when it is missing or not a folder. */
function jsonlFiles(folder: string): string[] {
  try {
    return readdirSync(folder)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .map((f) => join(folder, f));
  } catch {
    // missing, or a stray file where a folder should be: no sessions
    return [];
  }
}

export const sessionFolderPath = (worktree: string, env: Record<string, string | undefined>) => join(sessionsRoot(piDir(env)), sessionFolder(worktree));

/** The text of each session file of a working folder, none when it has no sessions. */
export const readSessions = (worktree: string, env: Record<string, string | undefined>): string[] =>
  worktree ? jsonlFiles(sessionFolderPath(worktree, env)).map((f) => readFileSync(f, "utf8")) : [];

/** Every session file pi keeps, by folder. */
export function allSessionFiles(env: Record<string, string | undefined>): string[][] {
  const root = sessionsRoot(piDir(env));
  try {
    return readdirSync(root).map((name) => jsonlFiles(join(root, name)));
  } catch {
    return [];
  }
}

const USAGE_LIMIT = /usage limit|quota|\b429\b.*(limit|too many|rate)|(limit|too many|rate).*\b429\b/i;

/** Whether a message names a usage limit. */
export const namesUsageLimit = (text: string): boolean => USAGE_LIMIT.test(text);
