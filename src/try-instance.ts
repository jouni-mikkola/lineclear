// The test instance of a build (see docs/stable-and-next.md): `lineclear release try [version]` builds a release into
// `builds/<version>` and runs its server on a copy of the real data, so a new build meets the data it takes over before it
// does. Everything it can write is in one folder under the cache: its config, its data, clones of the projects whose
// remote is a bare copy beside them, and a herdr session of its own. It gets no GitHub token, no SSH and only stub agents.
import { HERDR_SOCKET_ENV, herdrArgv, herdrSessionArgv, herdrSocketOf } from "./herdr.ts";
import { Database } from "bun:sqlite";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { readJson } from "../pi/config.ts";
import { buildsDir } from "./builds.ts";
import { dataDir, pathsFor } from "./paths.ts";
import { projectsDir } from "./project.ts";
import { cacheDir } from "./tmpdirs.ts";
import { gitWith } from "./git.ts";

type Env = Record<string, string | undefined>;

/** A candidate release is made at most this often; inside it the last one is tried again. */
const CANDIDATE_EVERY_MS = 30 * 60_000;
/** The data files it gets. Nothing else: no running agents, modes, machines, keys or secrets come along. */
const COPIED_FILES = [
  "tasks.json",
  "tasks-cold.jsonl",
  "settings.json",
  "spaces.json",
  "names.json",
  "order.json",
  "sections.json",
  "unread.json",
  "typed.json",
  "artifacts.json",
  "owner-direction.md",
];
const COPIED_FOLDERS = ["chatlog", "inbox", "tasks"];
/** What the copied tasks must not carry: they point at real worktrees, branches and pull requests. */
const TASK_LINKS = ["worktree", "branch", "pushed", "pr", "agent", "watch", "waitChecks"];
/** The variables the instance keeps; every other one (keys, tokens, sockets, the task's own chat) is dropped. */
const KEPT_ENV = ["PATH", "LANG", "LC_ALL", "TERM", "USER", "LOGNAME", "TMPDIR"];
const AGENT_CLIS = ["claude", "codex", "pi"];

/** `<cache>/try/state.json`: the instance that runs, while one does. */
export interface TryState {
  version: string;
  commit?: string;
  port: number;
  session: string;
  /** herdr's launcher, then the server. */
  pids: number[];
  at: string;
}

const tryRoot = (env: Env) => join(cacheDir(env), "try");
const worldDir = (env: Env) => join(tryRoot(env), "world");
const stateFile = (env: Env) => join(tryRoot(env), "state.json");
const candidateFile = (env: Env) => join(tryRoot(env), "candidate.json");

export function readTry(env: Env = process.env): TryState | undefined {
  return readJson(stateFile(env)) as TryState | undefined;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Whether the process still runs from this instance's folder; a pid left in state.json after a crash or reboot may belong to anything. */
function isOurs(pid: number, world: string): boolean {
  try {
    return readFileSync(`/proc/${pid}/environ`, "utf8")
      .split("\0")
      .includes(`LINECLEAR_HOME=${join(world, "home")}`);
  } catch {
    return false;
  }
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // already gone
  }
}

/** The lines of `lineclear release` and doctor for the test instance; none when there is none. */
export function tryLines(env: Env = process.env): string[] {
  const s = readTry(env);
  if (!s) return [];
  // herdr hands its session to a process of its own and exits, so the server is what shows the instance runs
  const state = isOurs(s.pids.at(-1) ?? 0, worldDir(env)) ? "running" : "stopped";
  return [`test    ${s.version}${s.commit ? ` (${s.commit.slice(0, 7)})` : ""} on port ${s.port}, ${state}`];
}

function runIn(cwd: string, cmd: string[]): string {
  const r = spawnSync(cmd[0] as string, cmd.slice(1), { cwd, encoding: "utf8", timeout: 20 * 60_000 });
  return r.status === 0 ? "" : `${cmd.join(" ")}: ${`${r.stdout}${r.stderr}`.trim().split("\n").slice(-4).join("; ")}`;
}

/** Builds `ref` into `builds/<version>` the way install.sh builds a release, without making it current. Returns the version or why not. */
function buildRelease(ref: string, version: string | undefined, env: Env): { version: string } | string {
  const builds = buildsDir(dataDir(env));
  if (version && existsSync(join(builds, version, ".release"))) return { version };
  const app = pathsFor(env).app;
  const origin = gitWith({ timeout: 300_000 }, app, "remote", "get-url", "origin");
  if (!origin.ok) return `no origin to build from: ${origin.err}`;
  mkdirSync(builds, { recursive: true });
  const part = join(builds, `.try-${process.pid}`);
  rmSync(part, { recursive: true, force: true });
  try {
    const clone = gitWith({ timeout: 300_000 }, builds, "clone", "-q", origin.out.trim(), part);
    if (!clone.ok) return `could not get ${ref}: ${clone.err}`;
    const checkout = gitWith({ timeout: 300_000 }, part, "checkout", "-q", "--detach", ref);
    if (!checkout.ok) return `could not get ${ref}: ${checkout.err}`;
    const name = version ?? `${readJson(join(part, "package.json"))?.version ?? "0.0.0"}-${ref.slice(0, 7)}`;
    const failed =
      runIn(part, ["bun", "install", "--frozen-lockfile", "--silent"]) ||
      runIn(join(part, "server"), ["bun", "install", "--frozen-lockfile", "--silent"]) ||
      runIn(part, ["bun", "run", "web:build"]) ||
      runIn(join(part, "server"), ["bun", "run", "build"]);
    if (failed) return `building ${name} failed: ${failed}`;
    rmSync(join(part, ".git"), { recursive: true, force: true });
    writeFileSync(join(part, ".release"), `${name}\n`);
    const dest = join(builds, name);
    rmSync(dest, { recursive: true, force: true });
    renameSync(part, dest);
    return { version: name };
  } finally {
    rmSync(part, { recursive: true, force: true });
  }
}

interface Space {
  path?: string;
  name?: string;
}

/** Clones a project's repo into the instance's folder, with a bare copy as its remote. Returns the clone's path, or undefined when `repo` is no repository. */
function cloneProject(repo: string, world: string, taken: Set<string>): string | undefined {
  if (!gitWith({ timeout: 300_000 }, repo, "rev-parse", "--git-dir").ok) return undefined;
  let name = repo.split("/").filter(Boolean).pop() ?? "repo";
  while (taken.has(name)) name += "-";
  taken.add(name);
  const bare = join(world, "bare", `${name}.git`);
  const clone = join(world, "repos", name);
  mkdirSync(join(world, "bare"), { recursive: true });
  mkdirSync(join(world, "repos"), { recursive: true });
  if (!gitWith({ timeout: 300_000 }, world, "clone", "-q", "--bare", "--no-local", repo, bare).ok) return undefined;
  if (!gitWith({ timeout: 300_000 }, world, "clone", "-q", bare, clone).ok) return undefined;
  // the bare copy must not name the real repo as its own origin
  gitWith({ timeout: 300_000 }, world, "-C", bare, "remote", "remove", "origin");
  return clone;
}

/** A file or folder that is not a link: a link in the copy would lead a write back to the real file. */
function isRealFile(path: string): boolean {
  try {
    const st = lstatSync(path);
    return !st.isSymbolicLink() && (st.isFile() || st.isDirectory());
  } catch {
    return false;
  }
}

/** The task ids database as one consistent file; stable may be writing it while it is read. */
function copyIds(from: string, to: string): void {
  if (!isRealFile(from)) return;
  const db = new Database(from, { readonly: true });
  try {
    db.exec("PRAGMA busy_timeout=5000");
    db.exec(`VACUUM INTO '${to.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
}

/** Takes the real worktree, branch, pull request and agent off each copied task, so no step of the instance reaches a real checkout. */
function cutColdLinks(file: string): void {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        const t = JSON.parse(l) as Record<string, unknown>;
        for (const k of TASK_LINKS) delete t[k];
        return [JSON.stringify(t)];
      } catch {
        return [];
      }
    });
  writeAtomic(file, lines.length ? `${lines.join("\n")}\n` : "");
}

function cutTaskLinks(file: string): void {
  const store = readJson(file) as { tasks?: Record<string, unknown>[] } | undefined;
  if (!store || !Array.isArray(store.tasks)) return;
  for (const t of store.tasks) for (const k of TASK_LINKS) delete t[k];
  writeAtomic(file, `${JSON.stringify(store)}\n`);
}

/** The copy of the real data: the store, the chats, the Inbox, the settings and the spaces (their paths pointed at the clones), and each project's settings. */
function copyWorld(env: Env, world: string): void {
  const from = dataDir(env);
  const data = join(world, "home");
  const config = join(world, "config");
  mkdirSync(data, { recursive: true });
  mkdirSync(config, { recursive: true });
  for (const name of COPIED_FILES) if (isRealFile(join(from, name))) cpSync(join(from, name), join(data, name));
  for (const name of COPIED_FOLDERS) if (existsSync(join(from, name))) cpSync(join(from, name), join(data, name), { recursive: true, filter: isRealFile });
  copyIds(join(from, "task-ids.sqlite"), join(data, "task-ids.sqlite"));
  cutTaskLinks(join(data, "tasks.json"));
  cutColdLinks(join(data, "tasks-cold.jsonl"));
  const taken = new Set<string>();
  const clones = new Map<string, string | undefined>();
  const clone = (repo: string) => {
    if (!clones.has(repo)) clones.set(repo, cloneProject(repo, world, taken));
    return clones.get(repo);
  };
  const spaces = readJson(join(data, "spaces.json")) as Space[] | undefined;
  if (Array.isArray(spaces)) {
    const kept = spaces.flatMap((s) => {
      const path = s.path ? clone(s.path) : undefined;
      return path ? [{ ...s, path }] : [];
    });
    writeAtomic(join(data, "spaces.json"), `${JSON.stringify(kept, null, 2)}\n`);
  }
  const projects = projectsDir(env as NodeJS.ProcessEnv);
  if (existsSync(projects)) {
    for (const name of readdirSync(projects)) {
      const file = join(projects, name, "settings.json");
      const settings = readJson(file) as { repo?: string } | undefined;
      if (!settings) continue;
      const repo = settings.repo ? clone(settings.repo) : undefined;
      if (!repo) continue;
      mkdirSync(join(config, "projects", name), { recursive: true });
      writeAtomic(join(config, "projects", name, "settings.json"), `${JSON.stringify({ ...settings, repo }, null, 2)}\n`);
    }
  }
  // the board's alerts stay off; a task that starts runs a stub agent, which does nothing
  const settings = (readJson(join(data, "settings.json")) ?? {}) as { machine?: Record<string, string> };
  writeAtomic(join(data, "settings.json"), `${JSON.stringify({ ...settings, machine: { ...settings.machine, "machine.alertHerdr": "off" } }, null, 2)}\n`);
}

/** The commands the instance finds first: stub agents, and `gh`, `ssh` and `git push` that refuse anything outside its own folder. */
function writeShims(dir: string, world: string): void {
  mkdirSync(dir, { recursive: true });
  const put = (name: string, body: string, whole = false) => {
    writeFileSync(join(dir, name), whole ? `${body}\n` : `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  for (const cli of AGENT_CLIS) put(cli, "exit 0");
  for (const cli of ["gh", "ssh", "scp"]) put(cli, `echo "${cli}: not available in the test instance" >&2\nexit 1`);
  const realGit =
    Bun.which("git", {
      PATH: (process.env.PATH ?? "")
        .split(":")
        .filter((d) => d !== dir)
        .join(":"),
    }) ?? "git";
  // bash: the arguments before `push` (-C <dir>, -c ...) are kept, so the remote is read where git will push from
  put(
    "git",
    `#!/bin/bash
pre=()
idx=
for ((i = 1; i <= $#; i++)); do
  a=\${!i}
  if [ "$a" = push ]; then idx=$i; break; fi
  pre+=("$a")
done
if [ -n "$idx" ]; then
  dest=
  for a in "\${@:$((idx + 1))}"; do
    case "$a" in -*) ;; *) dest=$a; break;; esac
  done
  url=$("${realGit}" "\${pre[@]}" remote get-url --push "\${dest:-origin}" 2>/dev/null || printf '%s' "$dest")
  case "$url" in /*) url=$(realpath -m -- "$url" 2>/dev/null || printf '%s' "$url");; esac
  case "$url" in "${world}"/*) ;; *) echo "git push: only the test instance's own copies take a push, not $url" >&2; exit 1;; esac
fi
exec "${realGit}" "$@"`,
    true,
  );
}

/** The environment of the instance's processes: its own folders and port, none of the real credentials. */
export function instanceEnv(env: Env, world: string, port: number, session: string): Record<string, string> {
  const shims = join(world, "shims");
  const kept = Object.fromEntries(KEPT_ENV.flatMap((k) => (env[k] === undefined ? [] : [[k, env[k] as string]])));
  const home = join(world, "user");
  const ident = {
    GIT_AUTHOR_NAME: "lineclear-try",
    GIT_AUTHOR_EMAIL: "try@localhost",
    GIT_COMMITTER_NAME: "lineclear-try",
    GIT_COMMITTER_EMAIL: "try@localhost",
  };
  return {
    ...kept,
    PATH: `${shims}:${kept.PATH ?? ""}`,
    SHELL: "/bin/sh",
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    ...ident,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_SSH_COMMAND: "false",
    GIT_TERMINAL_PROMPT: "0",
    GH_CONFIG_DIR: join(world, "gh"),
    LINECLEAR_CANARY: "1",
    LINECLEAR_RELEASE: "off",
    LINECLEAR_HOME: join(world, "home"),
    LINECLEAR_CONFIG: join(world, "config"),
    LINECLEAR_PORT: String(port),
    [HERDR_SOCKET_ENV]: herdrSocketOf(home, session),
  };
}

/** The environment of the running test instance, for the checks that talk to it; none when it does not run. */
export function runningTryEnv(env: Env = process.env): Record<string, string> | undefined {
  const s = readTry(env);
  return s ? instanceEnv(env, worldDir(env), s.port, s.session) : undefined;
}

function freePort(): number {
  const s = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = s.port as number;
  s.stop(true);
  return port;
}

/** Ends the instance and removes its folders. Stable's files are not touched. Returns whether there was one. */
export function stopTry(env: Env = process.env): boolean {
  const s = readTry(env);
  const world = worldDir(env);
  if (s) {
    const inst = instanceEnv(env, world, s.port, s.session);
    const [herdr, ...stop] = herdrArgv(["session", "stop", s.session]);
    spawnSync(herdr as string, stop, { stdio: "ignore", timeout: 20_000, env: inst });
    const ours = s.pids.filter((pid) => isOurs(pid, world));
    for (const pid of ours) killGroup(pid, "SIGTERM");
    // the folders go only once nothing writes into them
    for (let i = 0; i < 50 && ours.some((pid) => isOurs(pid, world)); i++) spawnSync("sleep", ["0.1"]);
    for (const pid of ours) if (isOurs(pid, world)) killGroup(pid, "SIGKILL");
  }
  rmSync(world, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(stateFile(env), { force: true });
  return s !== undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Builds `ref` (a release tag or a commit) when needed and starts the instance on a copy of the data. Returns its state, or why not. */
export async function startTry(ref: string, version: string | undefined, env: Env = process.env): Promise<TryState | string> {
  stopTry(env);
  const built = buildRelease(ref, version, env);
  if (typeof built === "string") return built;
  const world = worldDir(env);
  mkdirSync(world, { recursive: true });
  copyWorld(env, world);
  const session = `lineclear-try-${process.pid}`;
  const port = freePort();
  writeShims(join(world, "shims"), world);
  mkdirSync(join(world, "gh"), { recursive: true });
  const e = instanceEnv(env, world, port, session);
  const code = join(buildsDir(dataDir(env)), built.version);
  const log = openSync(join(world, "log"), "a");
  const state: TryState = { version: built.version, commit: ref.length === 40 ? ref : undefined, port, session, pids: [], at: new Date().toISOString() };
  mkdirSync(tryRoot(env), { recursive: true });
  // the state is written after each launch, so a crash in between still leaves something to stop
  const launch = (cmd: string[]) => {
    const p = spawn(cmd[0] as string, cmd.slice(1), { cwd: world, env: e, detached: true, stdio: ["ignore", log, log] });
    p.unref();
    state.pids.push(p.pid as number);
    writeAtomic(stateFile(env), `${JSON.stringify(state, null, 2)}\n`);
    return p.pid as number;
  };
  launch(herdrSessionArgv(session, ["server"]));
  const socket = e[HERDR_SOCKET_ENV] as string;
  for (let i = 0; i < 40 && !existsSync(socket); i++) await sleep(500);
  const server = launch([process.execPath, join(code, "bin", "lineclear"), "serve", "--port", String(port)]);
  // a build whose server was not built yet builds it first
  for (let i = 0; i < 480 && alive(server); i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/snapshot`)).ok) return state;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  const why = readFileSync(join(world, "log"), "utf8").trim().split("\n").slice(-12).join("; ");
  stopTry(env);
  return `the test instance did not answer on port ${port}: ${why}`;
}

/** A candidate release from main's newest green commit: the last one when it is under 30 minutes old, else a new one. */
function candidate(green: string | undefined, env: Env, now: Date): { ref: string; version?: string } | string {
  const last = readJson(candidateFile(env)) as { version?: string; commit: string; at: string } | undefined;
  if (last && now.getTime() - Date.parse(last.at) < CANDIDATE_EVERY_MS) {
    if (last.version && existsSync(join(buildsDir(dataDir(env)), last.version, ".release"))) return { ref: last.commit, version: last.version };
    return "the last candidate was tried less than 30 minutes ago and did not start: it is not tried again yet";
  }
  if (!green) return "main has no green commit yet: `lineclear release` shows how its test went";
  return { ref: green };
}

/** `lineclear release try [version]` and `lineclear release try --stop`. `green` is main's newest green commit, for a candidate. */
export async function tryMain(args: string[], out: (l: string) => void, env: Env, green: string | undefined, now = new Date()): Promise<number> {
  if (args[0] === "--stop") {
    out(stopTry(env) ? "lineclear release: the test instance is stopped and its folders are removed" : "lineclear release: no test instance is running");
    return 0;
  }
  if (args.length > 1 || args[0]?.startsWith("-") || (args[0] !== undefined && !/^\d+\.\d+\.\d+$/.test(args[0]))) {
    out("usage: lineclear release try [<version>|--stop]");
    return 2;
  }
  const want = args[0] ? { ref: `v${args[0]}`, version: args[0] } : candidate(green, env, now);
  if (typeof want === "string") {
    out(`lineclear release: ${want}`);
    return 1;
  }
  // the attempt is recorded before the build, so a failed one is not retried at once
  if (!args[0] && !want.version) {
    mkdirSync(tryRoot(env), { recursive: true });
    writeAtomic(candidateFile(env), `${JSON.stringify({ commit: want.ref, at: now.toISOString() })}\n`);
  }
  const s = await startTry(want.ref, want.version, env);
  if (typeof s === "string") {
    out(`lineclear release: ${s}`);
    return 1;
  }
  if (!args[0] && !want.version) {
    writeAtomic(candidateFile(env), `${JSON.stringify({ version: s.version, commit: want.ref, at: now.toISOString() })}\n`);
  }
  for (const l of tryLines(env)) out(l);
  return 0;
}
