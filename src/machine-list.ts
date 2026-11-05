import { join } from "node:path";
import { configDir, readJson } from "../pi/config.ts";

type Env = Record<string, string | undefined>;

/** A machine as saved: its SSH host and how its last install and doctor went. */
export interface SavedMachine {
  host: string;
  state: "installing" | "ready" | "failed";
  /** When the last install started, ISO time. */
  since: string;
  /** The doctor's lines, or what failed before it ran. */
  doctor?: string[];
  /** The process that installs it, while it installs. */
  pid?: number;
}

/** A machine as Settings shows it, with its load against its load limit (L7). */
export const HOST = /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}@)?[A-Za-z0-9][A-Za-z0-9.:_-]{0,252}$/;

export const machinesFile = (env: Env) => join(configDir(env), "machines.json");
const alive = (pid?: number) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

export function readMachines(env: Env = process.env): SavedMachine[] {
  try {
    const list = readJson(machinesFile(env))?.machines;
    if (!Array.isArray(list)) return [];
    return list
      .filter((m) => typeof m?.host === "string" && HOST.test(m.host))
      .map((m): SavedMachine => {
        // an install whose process is gone stopped half way, so it failed
        if (m.state === "installing" && !alive(m.pid))
          return { host: m.host, state: "failed", since: m.since, doctor: ["The install stopped before it finished. Try again."] };
        return m;
      });
  } catch {
    return [];
  }
}
