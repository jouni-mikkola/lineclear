import { closeSync, mkdirSync, openSync } from "node:fs";
import { herdrArgv } from "./herdr.ts";
import { join } from "node:path";
import { dataDir } from "./paths.ts";

type Env = Record<string, string | undefined>;

const herdrRuns = (env: Env) =>
  Bun.spawnSync(herdrArgv(["status", "server"]), { env: env as NodeJS.ProcessEnv, stdin: "ignore", stderr: "ignore" })
    .stdout.toString()
    .includes("status: running");

async function until(ok: () => boolean, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 4; i++) {
    if (ok()) return true;
    await Bun.sleep(250);
  }
  return false;
}

/**
 * Starts herdr's server unless one runs (agents run in its terminals), apart from this process so the terminals outlive
 * it. Returns why it could not, or undefined.
 */
export async function startHerdr(out: (l: string) => void, env: Env = process.env): Promise<string | undefined> {
  if (herdrRuns(env)) return undefined;
  const logs = join(dataDir(env), "logs");
  mkdirSync(logs, { recursive: true });
  const log = openSync(join(logs, "herdr-server.log"), "a");
  try {
    Bun.spawn(["setsid", ...herdrArgv(["server"])], { env: env as NodeJS.ProcessEnv, stdin: "ignore", stdout: log, stderr: log }).unref();
  } catch (e) {
    return `herdr did not start: ${e instanceof Error ? e.message : e}`;
  } finally {
    closeSync(log);
  }
  if (!(await until(() => herdrRuns(env), 20))) return "herdr's server did not start: see ~/.lineclear/logs/herdr-server.log";
  out("lineclear: started herdr's server");
  return undefined;
}
