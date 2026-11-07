// What the server and the CLI read of a machine: its load limit.
import { readFileSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

const configDir = (env: Env) => env.LINECLEAR_CONFIG ?? join(homedir(), ".config", "lineclear");

const positive = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

/** A machine's load limit: its machine.json's load per core (1 if unset) times its cores. */
function limitOf(machine: unknown, cores: number): number {
  const per = positive((machine as { loadPerCore?: unknown } | null)?.loadPerCore);
  return Math.round((per ?? 1) * cores * 100) / 100;
}

/** the machine's load limit, from <config>/machine.json; LINECLEAR_CORES stands in for the core count (tests) */
export function machineLimits(env: Env = process.env): { loadLimit: number } {
  let m: unknown = null;
  try {
    m = JSON.parse(readFileSync(join(configDir(env), "machine.json"), "utf8"));
  } catch {
    // none set
  }
  const cores = positive(Number(env.LINECLEAR_CORES)) ?? cpus().length;
  return { loadLimit: limitOf(m, cores) };
}
