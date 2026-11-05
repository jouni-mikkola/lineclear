import { closeSync, mkdirSync, openSync } from "node:fs";
import { herdrArgv } from "./herdr.ts";
import { join } from "node:path";
import { dataDir } from "./paths.ts";

// `lineclear run --board <port>`: where no service manager starts them, the loop starts the two things the rules need,
// herdr's server (agents run in its terminals) and the board's server (tasks, chats and merges).

type Env = Record<string, string | undefined>;

const answers = async (url: string) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
};

const herdrRuns = (env: Env) =>
  Bun.spawnSync(herdrArgv(["status", "server"]), { env: env as NodeJS.ProcessEnv, stdin: "ignore", stderr: "ignore" })
    .stdout.toString()
    .includes("status: running");

async function until(ok: () => boolean | Promise<boolean>, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 4; i++) {
    if (await ok()) return true;
    await Bun.sleep(250);
  }
  return false;
}

/**
 * Starts herdr's server unless one runs, apart from this process so its terminals outlive the loop, and the board's
 * server on `port` unless one answers there. Returns how to stop the board's server, or why one could not start.
 */
export async function startBoard(port: number, out: (l: string) => void, env: Env = process.env): Promise<{ stop: () => void } | { error: string }> {
  if (!(Number.isInteger(port) && port > 0 && port < 65536)) return { error: "--board needs a port" };
  const logs = join(dataDir(env), "logs");
  mkdirSync(logs, { recursive: true });
  if (!herdrRuns(env)) {
    const log = openSync(join(logs, "herdr-server.log"), "a");
    try {
      Bun.spawn(["setsid", ...herdrArgv(["server"])], { env: env as NodeJS.ProcessEnv, stdin: "ignore", stdout: log, stderr: log }).unref();
    } catch (e) {
      return { error: `herdr did not start: ${e instanceof Error ? e.message : e}` };
    } finally {
      closeSync(log);
    }
    if (!(await until(() => herdrRuns(env), 20))) return { error: "herdr's server did not start: see ~/.lineclear/logs/herdr-server.log" };
    out("lineclear run: started herdr's server");
  }
  const url = `http://127.0.0.1:${port}/api/snapshot`;
  if (await answers(url)) return { stop: () => undefined };
  const log = openSync(join(logs, "board.log"), "a");
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "..", "bin", "lineclear"), "serve", "--port", String(port)], {
    env: env as NodeJS.ProcessEnv,
    stdin: "ignore",
    stdout: log,
    stderr: log,
  });
  closeSync(log);
  if (!(await until(() => answers(url), 120))) {
    child.kill();
    return { error: `the board's server did not answer on port ${port}: see ~/.lineclear/logs/board.log` };
  }
  out(`lineclear run: the board's server answers on port ${port}`);
  return { stop: () => child.kill() };
}
