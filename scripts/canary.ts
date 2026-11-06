// The canary a promotion runs on next: next's own server and web pages, on spare
// ports, pass the smoke check and take one task through its life (start, brief, change, check, close).
// `bun scripts/canary.ts [--keep <dir>]` prints one line per step, exits 1 on the first that fails, and with --keep
// leaves the store next wrote in <dir>. The agent is a stub script, so it spends no tokens. Everything it touches
// is its own: a herdr session, a scratch store with a copy of this machine's settings, a scratch repo. No remote
// machine is run (LINECLEAR_CANARY), since herdr's machine list is shared by all its sessions.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { dataDir } from "../src/paths.ts";
import { diskTmpRoot } from "../src/tmpdirs.ts";
import { loadFactor as machineLoadFactor } from "./check-speed.ts";

const next = join(import.meta.dir, "..");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MARK = `canary-${process.pid}`;

/** The stub of every agent CLI: logs what it is given and, given the brief, makes the change and says it is ready. */
const STUB = `#!/bin/sh
log="$CANARY_LOG/agent-$$.log"
printf 'argv: %s\\nchat: %s\\n' "$*" "$LINECLEAR_CHAT" >>"$log"
printf '\\n> '
while IFS= read -r line; do
  printf 'in: %s\\n' "$line" >>"$log"
  case "$line" in *${MARK}*)
    task=\${LINECLEAR_CHAT%/Agent}
    herdr pane report-agent --source canary --agent pi --state working "$HERDR_PANE_ID" >>"$log" 2>&1
    echo "$line" >canary.txt && git add canary.txt && git commit -qm "Canary change" >>"$log" 2>&1
    "$LINECLEAR_COMMAND" ready "$task" --summary "canary" --facts "canary" >>"$log" 2>&1
    herdr pane report-agent --source canary --agent pi --state idle "$HERDR_PANE_ID" >>"$log" 2>&1
    echo "ready $task" >>"$log" ;;
  esac
  printf '\\n> '
done
`;

/** The settings of this machine, with no load or memory hold: the canary task must start on a busy machine too. */
function settingsCopy(): string {
  let s: { everywhere?: object; machine?: Record<string, string>; spaces?: object } = {};
  try {
    s = JSON.parse(readFileSync(join(dataDir(), "settings.json"), "utf8"));
  } catch {
    // a machine with no settings yet runs on the defaults
  }
  const machine = { ...s.machine, "machine.maxTasks": "200", "machine.startLoad": "20× cores", "machine.startMemory": "100%", "machine.alertHerdr": "off" };
  return JSON.stringify({ everywhere: s.everywhere ?? {}, machine, spaces: {} });
}

interface World {
  dir: string;
  home: string;
  api: number;
  web: number;
  session: string;
  socket: string;
  repo: string;
  env: Record<string, string>;
  stops: (() => void)[];
}

function world(api: number, web: number): World {
  const dir = mkdtempSync(join(diskTmpRoot(), "canary-"));
  const stub = join(dir, "stub");
  mkdirSync(stub);
  for (const cli of ["claude", "codex", "pi"]) {
    writeFileSync(join(stub, cli), STUB);
    chmodSync(join(stub, cli), 0o755);
  }
  const home = join(dir, "home");
  mkdirSync(home);
  writeFileSync(join(home, "settings.json"), settingsCopy());
  // herdr names a task's worktree folder after the repo: a name of its own, so the cleanup removes only its own
  const repo = join(dir, MARK);
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "-c", "user.name=canary", "-c", "user.email=canary@localhost", "commit", "-q", "--allow-empty", "-m", "start");
  const session = MARK;
  const socket = join(homedir(), ".config", "herdr", "sessions", session, "herdr.sock");
  const { ENV: _, ...base } = process.env as Record<string, string>;
  const env = {
    ...base,
    PATH: `${stub}:${base.PATH}`,
    // a login shell's profile would put the real agent CLIs first again
    SHELL: "/bin/sh",
    CANARY_LOG: dir,
    LINECLEAR_CANARY: "1",
    LINECLEAR_HOME: home,
    LINECLEAR_CONFIG: join(dir, "config"),
    LINECLEAR_PORT: String(api),
    HERDR_SOCKET_PATH: socket,
    GIT_AUTHOR_NAME: "canary",
    GIT_AUTHOR_EMAIL: "canary@localhost",
    GIT_COMMITTER_NAME: "canary",
    GIT_COMMITTER_EMAIL: "canary@localhost",
  };
  for (const k of ["LINECLEAR_CHAT", "LINECLEAR_URL", "LINECLEAR_COMMAND", "LINECLEAR_SECRET_FILE"]) delete (env as Record<string, string | undefined>)[k];
  return { dir, home, api, web, session, socket, repo, env, stops: [] };
}

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

/** Starts a long-running process of the canary; it is stopped at the end. */
function start(w: World, cmd: string[], name: string, env: Record<string, string> = {}) {
  const p = spawn(cmd[0] as string, cmd.slice(1), { cwd: w.dir, env: { ...w.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const log: string[] = [];
  p.stdout.on("data", (d) => log.push(String(d)));
  p.stderr.on("data", (d) => log.push(String(d)));
  w.stops.push(() => p.kill("SIGTERM"));
  return { p, log: () => `${name}: ${log.join("").trim().split("\n").slice(-3).join(" ")}` };
}

/** How many times longer a wait may take on a busy machine: the machine load per core, between 1 and 8. */
export const loadFactor = (load?: number, cores?: number) => Math.min(8, machineLoadFactor(load, cores));

/** The text of a ready-wait timeout: what was seen, then the tail of the stub agent's log so the cause shows. */
export function readyTimeout(message: string, seen: { status?: string; sub?: string } | undefined, agentLog: string): string {
  const tail = agentLog.trim().split("\n").slice(-15).join("\n");
  return `${message}: ${seen ? `${seen.status} ${seen.sub}` : "no task seen"}\nagent log tail:\n${tail || "(empty)"}`;
}

async function until<T>(what: string, seconds: number, probe: () => T | undefined | Promise<T | undefined>): Promise<T> {
  const limit = Math.round(seconds * loadFactor());
  const end = Date.now() + limit * 1000;
  let last = "";
  while (Date.now() < end) {
    try {
      const v = await probe();
      if (v !== undefined && v !== false) return v;
    } catch (e) {
      last = (e as Error).message;
    }
    await sleep(500);
  }
  throw new Error(`${what} within ${limit} s${last ? ` (${last})` : ""}`);
}

function lineclear(w: World, ...args: string[]): string {
  const r = spawnSync(join(next, "server", "bin", "lineclear"), ["--url", `http://127.0.0.1:${w.api}`, ...args], {
    cwd: w.repo,
    env: w.env,
    encoding: "utf8",
    timeout: Math.round(60_000 * loadFactor()),
  });
  if (r.status !== 0) throw new Error(`lineclear ${args.slice(0, 2).join(" ")}: ${(r.stdout + r.stderr).trim().split("\n")[0]}`);
  return r.stdout.trim();
}

const agentLogs = (w: World) => (spawnSync("sh", ["-c", 'cat "$1"/agent-*.log 2>/dev/null', "sh", w.dir], { encoding: "utf8" }).stdout ?? "").toString();

interface Task {
  id: string;
  state?: string;
  status?: string;
  sub?: string;
  branch?: string;
}
const task = (w: World): Task | undefined => (JSON.parse(lineclear(w, "task", "list", "--space", "canary", "--json")) as Task[])[0];

/** The folder git has checked out `branch` in, if any. */
function worktreeOf(w: World, branch?: string): string | undefined {
  if (!branch) return undefined;
  const blocks = git(w.repo, "worktree", "list", "--porcelain").split("\n\n");
  const block = blocks.find((b) => b.includes(`branch refs/heads/${branch}`));
  return block?.match(/^worktree (.+)$/m)?.[1];
}

/** The steps, each a line of its own. Throws on the first that fails. */
async function steps(w: World, say: (l: string) => void) {
  const herdr = start(w, ["herdr", "--session", w.session, "server"], "herdr");
  await until(`herdr session ${w.session} did not start (${herdr.log()})`, 20, () => existsSync(w.socket));
  // a fresh checkout has not generated the server's plugin list yet
  const plugins = spawnSync(process.execPath, ["scripts/build-plugins.ts"], { cwd: join(next, "server"), encoding: "utf8" });
  if (plugins.status !== 0) throw new Error(`plugins: ${plugins.stderr.trim()}`);
  if (!existsSync(join(next, "ui", "web", "dist"))) {
    const built = spawnSync(process.execPath, ["run", "web:build"], { cwd: next, encoding: "utf8" });
    if (built.status !== 0) throw new Error(`web:build: ${(built.stderr + built.stdout).trim().split("\n").pop()}`);
  }
  const server = start(w, [process.execPath, join(next, "server", "server", "main.ts")], "server");
  await until(`the server did not answer on ${w.api} (${server.log()})`, 60, async () => (await fetch(`http://127.0.0.1:${w.api}/api/snapshot`)).ok);
  start(w, [process.execPath, join(next, "bin", "lineclear"), "run"], "web", { LINECLEAR_PORT: String(w.web) });
  say(`ok   start: next's server answers on ${w.api}`);
  lineclear(w, "space", "add", w.repo, "--name", "canary");
  const smoke = spawnSync(process.execPath, [join(next, "scripts", "smoke.ts"), "check", "-", "api"], {
    env: { ...w.env, LINECLEAR_PORT: String(w.web), LINECLEAR_SMOKE_SECONDS: String(Math.round(60 * loadFactor())) },
    encoding: "utf8",
  });
  if (smoke.status !== 0) throw new Error(`smoke: ${(smoke.stdout + smoke.stderr).trim().replace(/\n/g, "; ")}`);
  say(`ok   smoke: pages on ${w.web}, the API, a chat message`);
  lineclear(w, "task", "add", "Canary", "--brief", `${MARK}: write canary.txt and commit it`, "--space", "canary");
  const id = (await until("the task was not added", 20, () => task(w))).id;
  await until(`${id}'s agent did not get its brief`, 120, () => agentLogs(w).includes(`in: ${MARK}`));
  say(`ok   brief: ${id}'s agent got its brief`);
  const t = await until(`${id} has no worktree`, 30, () => worktreeOf(w, (JSON.parse(lineclear(w, "task", "show", id, "--json")) as Task).branch));
  await until(`${id}'s branch has no change`, 60, () => existsSync(join(t, "canary.txt")) && git(t, "log", "-1", "--format=%s") === "Canary change");
  say(`ok   change: ${id} committed canary.txt on its branch`);
  let seen: Task | undefined;
  // 60 s on an idle machine; a fixed cap on top of the load scaling failed healthy runs on a busy one
  await until(`${id} did not show ready`, 60, () => {
    seen = task(w);
    return seen?.status === "ready";
  }).catch((e) => {
    throw new Error(readyTimeout((e as Error).message, seen, agentLogs(w)));
  });
  say(`ok   check: ${id} shows ready to merge`);
  lineclear(w, "task", "close", id, "--summary", "canary done", "--discard");
  await until(`${id} did not close`, 60, () => (task(w)?.status ?? "done") === "done");
  say(`ok   close: ${id} is closed`);
}

/** Two free ports, one for next's server and one for its web pages. */
function freePorts(): [number, number] {
  const a = Bun.serve({ port: 0, fetch: () => new Response() });
  const b = Bun.serve({ port: 0, fetch: () => new Response() });
  const ports: [number, number] = [a.port as number, b.port as number];
  a.stop(true);
  b.stop(true);
  return ports;
}

function cleanUp(w: World) {
  for (const stop of w.stops.reverse()) stop();
  spawnSync("herdr", ["session", "stop", w.session], { stdio: "ignore", timeout: 20_000 });
  spawnSync("herdr", ["session", "delete", w.session], { stdio: "ignore", timeout: 20_000 });
  rmSync(join(homedir(), ".herdr", "worktrees", basename(w.repo)), { recursive: true, force: true });
  rmSync(w.dir, { recursive: true, force: true });
}

function copyable(file: string): boolean {
  try {
    const st = lstatSync(file);
    return st.isFile() || st.isDirectory();
  } catch {
    return false;
  }
}

/** Runs the canary on next's code; returns what failed, or "" when every step passed. With `keep`, the store
 *  next wrote is copied there first. */
async function canary(keep?: string, say: (l: string) => void = console.log): Promise<string> {
  const w = world(...freePorts());
  try {
    await steps(w, say);
    return "";
  } catch (e) {
    return (e as Error).message;
  } finally {
    for (const stop of w.stops.splice(0).reverse()) stop();
    if (keep) {
      // files and folders only: a socket cannot be copied, and a file a stopping process removes is gone
      cpSync(w.home, keep, { recursive: true, filter: copyable });
    }
    cleanUp(w);
  }
}

if (import.meta.main) {
  const at = process.argv.indexOf("--keep");
  const failed = await canary(at > 0 ? process.argv[at + 1] : undefined);
  if (failed) console.log(`fail ${failed}`);
  process.exit(failed ? 1 : 0);
}
