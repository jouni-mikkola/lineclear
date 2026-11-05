import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readJson } from "../pi/config.ts";
import { dataDir } from "./paths.ts";

// Shepherdr 2.0's folder. Only `lineclear migrate` and the checks about moving off it name it, and they do it here.
// A test fails if any other code of Lineclear names it (test/no-old-folder.test.ts).

type Env = Record<string, string | undefined>;

/** Shepherdr 2.0's data folder, which `lineclear migrate` reads and never changes. */
export const oldDir = (env: Env = process.env) => env.LINECLEAR_OLD_DIR ?? join(homedir(), ".shepherdr");

/** The old folder as a person reads it, for messages. */
export const OLD_DIR_NAME = "~/.shepherdr";

/** The other folder Shepherdr 2.0 left, where its projects plugin kept its data. */
const oldProjectsDir = (env: Env = process.env) => env.LINECLEAR_OLD_PROJECTS_DIR ?? join(homedir(), ".herdr-projects");

/** The old folders that still exist on this machine. */
export const oldFolders = (env: Env = process.env) => [oldDir(env), oldProjectsDir(env)].filter((d) => existsSync(d));

/** Where the archives go: `<name>-<date>.tgz` for each old folder. */
export const archiveDir = (env: Env = process.env) => env.LINECLEAR_ARCHIVE_DIR ?? join(homedir(), "archive");

/**
 * Running processes that use an old folder: a file open in it, its command line, its working folder, or an
 * environment value (the agent's PATH, its command) or a socket that points into it. Agents started before the move
 * are among them, and the tools they started. Empty means nothing needs the folders, so they may be archived.
 * `procRoot` is a test seam.
 */
export function oldFolderUsers(env: Env = process.env, procRoot = "/proc", self = process.pid): string[] {
  const dirs = [oldDir(env), oldProjectsDir(env)];
  const inside = (path: string) => dirs.some((d) => path === d || path.startsWith(`${d}/`));
  const pointsIn = (value: string) => value.split(":").some(inside) || dirs.some((d) => value.includes(`${d}/`));
  const users: string[] = [];
  let pids: string[];
  try {
    pids = readdirSync(procRoot).filter((n) => /^\d+$/.test(n) && Number(n) !== self);
  } catch {
    return users;
  }
  const sockets = socketInodes(procRoot, inside);
  for (const pid of pids) {
    const at = join(procRoot, pid);
    try {
      const cmd = readFileSync(join(at, "cmdline"), "utf8").replaceAll("\0", " ");
      const via =
        pointsIn(cmd) ||
        readFileSync(join(at, "environ"), "utf8").split("\0").some(pointsIn) ||
        inside(safeLink(join(at, "cwd"))) ||
        openFiles(at).some((l) => inside(l) || sockets.has(l));
      if (via) users.push(`${pid} ${cmd.trim().slice(0, 80)}`);
    } catch {
      // another user's process, or one that just ended
    }
  }
  return users;
}

const safeLink = (path: string) => {
  try {
    return readlinkSync(path);
  } catch {
    return "";
  }
};

/** What a process has open: file paths, and `socket:[inode]` for a socket. */
function openFiles(proc: string): string[] {
  try {
    return readdirSync(join(proc, "fd")).map((fd) => safeLink(join(proc, "fd", fd)));
  } catch {
    return [];
  }
}

/** The `socket:[inode]` names of unix sockets bound to a path in an old folder. */
function socketInodes(procRoot: string, inside: (path: string) => boolean): Set<string> {
  const found = new Set<string>();
  try {
    for (const line of readFileSync(join(procRoot, "net", "unix"), "utf8").split("\n")) {
      const cols = line.trim().split(/\s+/);
      if (cols.length >= 8 && inside(cols[7] ?? "")) found.add(`socket:[${cols[6]}]`);
    }
  } catch {
    // no socket table: only the other signs count
  }
  return found;
}

/** Which side still runs: both keep their tasks in memory and save over a folder written under them. */
export type Busy = (side: "lineclear" | "shepherdr", env: Env) => boolean;

export const realBusy: Busy = (side, env) => {
  try {
    const pid = readJson(join(side === "lineclear" ? dataDir(env) : oldDir(env), "server.json"))?.pid;
    if (typeof pid !== "number") return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
