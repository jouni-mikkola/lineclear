import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { dataDir } from "./paths.ts";
import { OLD_NAME, oldDir } from "./old-install.ts";

type Env = Record<string, string | undefined>;

/** Where an agent's old command finds the server on a machine: the helper's socket, under each data folder. */
const sockets = (env: Env) => ({ old: join(oldDir(env), "helper", "main.sock"), now: join(dataDir(env), "helper", "main.sock") });

const linked = (env: Env) => {
  const { old, now } = sockets(env);
  try {
    return lstatSync(old).isSymbolicLink() && readlinkSync(old) === now;
  } catch {
    return false;
  }
};

/** True when Lineclear is in use here and an agent started under herdr-projects 2.0 would find no socket. */
export function helperApart(env: Env = process.env): boolean {
  // no old helper folder: no agent was ever started under herdr-projects 2.0 here
  if (!existsSync(join(oldDir(env), "helper"))) return false;
  const inUse = existsSync(join(dataDir(env), "migrated.json")) || existsSync(join(dataDir(env), "helper"));
  return inUse && !linked(env);
}

/** Makes the old socket path a link to the new one, so agents of either find the server. Returns whether it changed anything. */
export function linkHelper(env: Env = process.env): boolean {
  if (!existsSync(join(oldDir(env), "helper")) || linked(env)) return false;
  const { old, now } = sockets(env);
  mkdirSync(join(dataDir(env), "helper"), { recursive: true });
  rmSync(old, { force: true });
  symlinkSync(now, old);
  return true;
}

/** Running agents started before the command was renamed: their `LINECLEAR_COMMAND` still ends in the old name. Each is its chat name (else its pid). `procRoot` is a test seam. */
export function agentsOnOldName(procRoot = "/proc", self = process.pid): string[] {
  const found: string[] = [];
  let pids: string[];
  try {
    pids = readdirSync(procRoot).filter((n) => /^\d+$/.test(n) && Number(n) !== self);
  } catch {
    return found;
  }
  for (const pid of pids) {
    try {
      const vars = readFileSync(join(procRoot, pid, "environ"), "utf8").split("\0");
      if (!vars.some((v) => v.startsWith("LINECLEAR_COMMAND=") && v.endsWith(`/${OLD_NAME}`))) continue;
      if (!vars.includes(`HOME=${homedir()}`)) continue;
      found.push(vars.find((v) => v.startsWith("LINECLEAR_CHAT="))?.slice("LINECLEAR_CHAT=".length) || `process ${pid}`);
    } catch {
      // another user's process, or one that just ended
    }
  }
  return [...new Set(found)].sort();
}
