// The smoke check install.sh runs after an update restarts the service (see "An update that breaks rolls back" in the
// README). `bun scripts/smoke.ts check <projects-folder> <api|noapi>` retries each check until LINECLEAR_SMOKE_SECONDS (default 120)
// are up and prints one line per failure.
// `bun scripts/smoke.ts branch` is the merge lane's: it starts this checkout's service on free ports with a scratch
// data folder, runs the web and API checks against it, stops it, and prints one line per failure.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir } from "../src/paths.ts";
import { projectsDir } from "../src/project.ts";

const env = process.env;
const seconds = Number(env.LINECLEAR_SMOKE_SECONDS ?? 120);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Where the service answers: its web pages, and its API (the port its data folder's server.json names). */
interface Target {
  web: string;
  api: () => number;
}

const live: Target = {
  web: `http://127.0.0.1:${env.LINECLEAR_WEB_PORT ?? env.LINECLEAR_PORT ?? 7421}`,
  api() {
    try {
      return JSON.parse(readFileSync(join(dataDir(env), "server.json"), "utf8")).port;
    } catch {
      return 7421;
    }
  },
};

async function get(url: string): Promise<Response> {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return r;
}

/** The pages `lineclear run` serves. */
async function pages(t: Target) {
  for (const p of ["/", "/inbox"]) await get(t.web + p);
}

interface Place {
  id: string;
  machine?: string;
  home?: boolean;
  mode?: string;
  chat?: string;
}
const snapshot = async (t: Target) => (await (await get(`http://127.0.0.1:${t.api()}/api/snapshot`)).json()) as { host?: string; places: Place[] };

/** What the board says when the coordinator's agent is not running and did not start for the probe. */
export const IDLE_COORDINATOR = /^The agent isn't running\.?$/;

/** The 'probe' action: a hidden line to this machine's home coordinator that asks for no reply and answers no card. */
async function chat(t: Target) {
  const { host, places } = await snapshot(t);
  const here = places.filter((p) => p.machine === host);
  const to = here.find((p) => p.home) ?? here[0];
  if (!to) throw new Error("the board lists no space on this machine");
  const r = await fetch(`http://127.0.0.1:${t.api()}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-lineclear": "1" },
    body: JSON.stringify({ type: "probe", chat: to.chat ?? to.id }),
    signal: AbortSignal.timeout(15000),
  });
  const body = (await r.json().catch(() => ({}))) as { error?: string; ok?: boolean };
  // A coordinator that is simply idle (no agent running, none to start) is not a broken chat: the board took the message.
  if (body.error && IDLE_COORDINATOR.test(body.error)) return;
  if (!r.ok || body.error || body.ok === false) throw new Error(`the chat of ${to.id} refused a message: ${body.error ?? r.status}`);
}

/** Whether each project in a folder of settings copies is Paused, by name. */
export function pausedIn(dir: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    try {
      out[name] = JSON.parse(readFileSync(join(dir, name, "settings.json"), "utf8")).paused === true;
    } catch {}
  }
  return out;
}

const word = (paused: boolean) => (paused ? "Paused" : "Running");

/** Each project is Running or Paused as it was before the update. A project removed meanwhile is not one. */
async function runningOrPaused(before: Record<string, boolean>) {
  const now = pausedIn(projectsDir(env));
  const moved = Object.entries(before).flatMap(([n, was]) => {
    const is = now[n];
    return is === undefined || is === was ? [] : [`${n} is ${word(is)}, it was ${word(was)}`];
  });
  if (moved.length) throw new Error(moved.join("; "));
}

/** Runs every check until it passes or the time is up; returns what still failed. */
export async function check(before: Record<string, boolean>, api = true, limit = seconds, t: Target = live, scratch = false): Promise<string[]> {
  // A machine that did not run the Lineclear API before the update has nothing to compare it with. A scratch data
  // folder has no spaces, so there is no chat to write to and no project to keep Running or Paused.
  const checks: [string, () => Promise<void>][] = [
    ["the web pages do not answer", () => pages(t)],
    ...(scratch ? [] : ([["Running or Paused", () => runningOrPaused(before)]] as [string, () => Promise<void>][])),
    ...(api
      ? ([
          ["the board API does not answer", async () => void (await snapshot(t))],
          ...(scratch ? [] : [["a coordinator chat does not accept a message", () => chat(t)]]),
        ] as [string, () => Promise<void>][])
      : []),
  ];
  const failed = new Map<string, string>();
  const done = new Set<string>();
  const end = Date.now() + limit * 1000;
  do {
    for (const [name, run] of checks) {
      if (done.has(name)) continue;
      try {
        await run();
        done.add(name);
        failed.delete(name);
      } catch (e) {
        failed.set(name, name === "Running or Paused" ? (e as Error).message : `${name} (${(e as Error).message})`);
      }
    }
    if (done.size < checks.length) await sleep(2000);
  } while (done.size < checks.length && Date.now() < end);
  return [...failed.values()];
}

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = probe.port as number;
  await probe.stop(true);
  return port;
}

/** Starts the checkout's one service (pages and API on one port) on a free port and checks it. */
export async function checkBranch(root: string, limit = seconds): Promise<string[]> {
  // a fresh checkout has no built pages; a build that fails is a service that cannot start
  if (existsSync(join(root, "ui", "web")) && !existsSync(join(root, "ui", "web", "dist"))) {
    const built = Bun.spawnSync(["bun", "run", "web:build"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if (built.exitCode !== 0) return [`the web pages do not build (${`${built.stderr}${built.stdout}`.trim().split("\n").pop()})`];
  }
  const scratch = mkdtempSync(join(tmpdir(), "lineclear-smoke-"));
  const port = await freePort();
  // its own HOME and sockets: the service must not reach this machine's herdr or the browsers of running tasks
  mkdirSync(join(scratch, "home"));
  // `run` refuses to start until every role has a model (setupGate)
  mkdirSync(join(scratch, "config"), { recursive: true });
  writeFileSync(
    join(scratch, "config", "setup.json"),
    JSON.stringify({ worker: "claude-opus-5-5", reviewer: "gpt-5", planner: "claude-opus-5-5", stepChecker: "gpt-5" }),
  );
  const base = {
    ...process.env,
    HOME: join(scratch, "home"),
    XDG_RUNTIME_DIR: join(scratch, "run"),
    HERDR_SOCKET_PATH: join(scratch, "no-herdr.sock"),
    LINECLEAR_SCRATCH: "1",
    LINECLEAR_HOME: scratch,
    LINECLEAR_CONFIG: join(scratch, "config"),
    XDG_DATA_HOME: join(scratch, "data"),
  };
  const service = Bun.spawn(["bun", join(root, "bin", "lineclear"), "run"], {
    cwd: root,
    env: { ...base, LINECLEAR_PORT: String(port) },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  // the lane stops a slow check with a signal: the services must not outlive it
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      service.kill();
      rmSync(scratch, { recursive: true, force: true });
      process.exit(1);
    });
  }
  try {
    // a service that stops by itself will not answer: say so at once, not when the time is up
    const stopped = service.exited.then((code) => [`the service stopped with exit code ${code}`]);
    const target: Target = { web: `http://127.0.0.1:${port}`, api: () => port };
    return await Promise.race([check({}, true, limit, target, true), stopped]);
  } finally {
    service.kill();
    await service.exited;
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [verb, arg = "", api = "api"] = process.argv.slice(2);
  if (verb === "check") {
    const before = pausedIn(arg);
    const failed = await check(before, api === "api");
    for (const f of failed) console.log(f);
    process.exit(failed.length ? 1 : 0);
  } else if (verb === "branch") {
    const failed = await checkBranch(join(import.meta.dir, ".."));
    for (const f of failed) console.log(f);
    process.exit(failed.length ? 1 : 0);
  } else {
    console.error("usage: smoke.ts check <projects-folder> <api|noapi>");
    process.exit(2);
  }
}
