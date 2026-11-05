import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Harness, jsonlFiles, type SessionFolder, stallFromText } from "./harness.ts";
import { piDir } from "./paths.ts";
import { sessionUsage } from "./session-text.ts";

/** pi keeps a folder of sessions per working folder: its path with `/` as `-`, between `--`. */
export function sessionFolder(worktree: string): string {
  return `--${worktree.replace(/^\//, "").replace(/\//g, "-")}--`;
}

const sessionsRoot = (home: string) => join(home, "sessions");

const folderPath = (worktree: string, env: Record<string, string | undefined>) => join(sessionsRoot(piDir(env)), sessionFolder(worktree));

const sessionFiles = (worktree: string, env: Record<string, string | undefined>) => (worktree ? jsonlFiles(folderPath(worktree, env)) : []);

export const piHarness: Harness = {
  name: "pi",
  start: (model, prompt) => ["pi", ...(model ? ["--model", model] : []), prompt],
  home: piDir,
  sessionsRoot,
  sessionFolderPath: folderPath,
  sessionFiles,
  readSessions: (worktree, env) => sessionFiles(worktree, env).map((f) => readFileSync(f, "utf8")),
  allSessionFolders(env): SessionFolder[] {
    const root = sessionsRoot(piDir(env));
    if (!existsSync(root)) return [];
    return readdirSync(root).map((name) => ({ name, files: jsonlFiles(join(root, name)) }));
  },
  usage: sessionUsage,
  stallSignal: stallFromText,
};
