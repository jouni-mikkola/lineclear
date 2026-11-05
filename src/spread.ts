import { readFileSync } from "node:fs";
import { join } from "node:path";
import { helperCommand } from "./paths.ts";
import { listProjectNames, projectsDir, readSettings } from "./project.ts";
import type { Task } from "./roadmap.ts";
import { quote, REMOTE_PATH, sshArgs } from "./ssh.ts";
import { secretsText } from "./secrets.ts";
import { limitOf, slotsOf } from "./waits.ts";

type Env = Record<string, string | undefined>;

// A project's steps may run on other machines. Each machine runs its own Shepherdr (its helper), so this machine asks
// it over SSH and never reads a file of its own. A machine that cannot be reached is a text, never a throw.

/** Shepherdr's command on another machine: Lineclear's helper, which every machine has. */
const REMOTE_SHEPHERDR = helperCommand(true);
const TIMEOUT_MS = 40_000;

/** What one machine says about its room for a project's steps. */
export interface Room {
  host: string;
  /** The project's tasks there, ids ending in `@host` so they never meet a local id. */
  tasks: Task[];
  /** Tasks at work on the machine, in every space: its slots are shared. */
  working: number;
  max: number | undefined;
  load: number;
  loadLimit: number;
  /** Check slots in use and in all. */
  slotsBusy: number;
  slots: number;
  /** Set when it runs another build than this machine: why no task starts there. */
  apart?: string;
}

/**
 * Asks each machine for its room once. One that cannot be reached is skipped, but still holds what it last ran: its
 * known tasks keep their locks and steps. `seen` is the project's memory of that, updated here.
 */
export function askMachines(
  hosts: string[],
  seen: Record<string, Task[]>,
  room: (host: string) => Room | string,
  skipped: (host: string, why: string) => void,
) {
  for (const host of Object.keys(seen)) if (!hosts.includes(host)) delete seen[host];
  const rooms = new Map<string, Room>();
  const remote: Task[] = [];
  for (const host of hosts) {
    const r = room(host);
    if (typeof r === "string") {
      const known = (seen[host] ?? []).filter((t) => t.status !== "done");
      skipped(host, `machine ${host} skipped: ${r}${known.length > 0 ? `; its ${known.length} known open tasks still count` : ""}`);
      remote.push(...(seen[host] ?? []));
    } else {
      rooms.set(host, r);
      seen[host] = r.tasks;
      remote.push(...r.tasks);
    }
  }
  return { rooms, remote };
}

/** Why the machine takes no new task now, or undefined when it has room. */
export function roomLack(r: Room): string | undefined {
  if (r.apart) return r.apart;
  if (r.max === undefined) return "cannot read its slots from the server";
  if (r.working >= r.max) return `no free slot (${r.working} of ${r.max} working)`;
  if (r.load > r.loadLimit) return `load average ${r.load.toFixed(1)} is above its limit of ${r.loadLimit}`;
  if (r.slotsBusy >= r.slots) return `all ${r.slots} check slots are in use`;
  return undefined;
}

/** A machine on another build than this one's takes no task: two builds would act on the same tasks in two ways. A commit settles it; a release has none, so its version does. */
function buildApart(host: string, theirs: string[], mine: { version: string; commit: string }): string | undefined {
  const [version = "", commit = ""] = theirs;
  if (!version) return `its lineclear does not say which build it runs: no task starts there until \`lineclear machine update ${host}\``;
  const hex = (c: string) => /^[0-9a-f]{7,40}$/.test(c) && /^[0-9a-f]{7,40}$/.test(mine.commit);
  const same = hex(commit) ? mine.commit.startsWith(commit) || commit.startsWith(mine.commit) : version === mine.version;
  if (same) return undefined;
  const name = (v: string, c: string) => (hex(c) ? c.slice(0, 7) : v);
  return `it runs ${name(version, commit)} but this machine runs ${name(mine.version, mine.commit)}: no task starts there until \`lineclear machine update ${host}\``;
}

const readScript = (space: string) => `${REMOTE_PATH}
S=${REMOTE_SHEPHERDR}
echo "load $(cut -d' ' -f1 /proc/loadavg)"
echo "cores $(nproc)"
echo "build $("$HOME/.local/bin/lineclear" --version 2>/dev/null | awk '{print $2, $3}')"
echo "machine $(cat "$HOME/.config/lineclear/machine.json" 2>/dev/null | tr -d '\\n')"
n=0; for f in "$HOME"/.config/lineclear/check-slots/*/slot-*; do [ -f "$f" ] && kill -0 "$(cat "$f")" 2>/dev/null && n=$((n+1)); done; echo "busy $n"
echo "max $("$S" show 2>/dev/null | sed -n 's/^machine.maxTasks[[:space:]]*\\([0-9]*\\).*/\\1/p')"
# A space the machine does not have yet lists nothing (shepherdr answers with a sentence and exit code 1).
if o=$("$S" task list --json 2>/dev/null); then echo "all $(echo "$o" | tr -d '\\n')"; fi
if o=$("$S" task list --space ${quote(space)} --json 2>/dev/null); then echo "mine $(echo "$o" | tr -d '\\n')"; fi
`;

/** Parses the answer of `readScript`. */
function parseRoom(host: string, text: string, build?: { version: string; commit: string }): Room | string {
  const field = (k: string) =>
    text
      .split("\n")
      .find((l) => l.startsWith(`${k} `))
      ?.slice(k.length + 1)
      .trim() ?? "";
  const load = Number(field("load"));
  const cores = Number(field("cores"));
  if (!Number.isFinite(load) || !Number.isFinite(cores) || field("load") === "") return `${host} gave no load`;
  let slots = slotsOf(undefined, cores);
  let limit = limitOf(undefined, cores);
  try {
    const m = JSON.parse(field("machine") || "{}");
    slots = slotsOf(m, cores);
    limit = limitOf(m, cores);
  } catch {
    // no machine settings there: the defaults
  }
  let all: Task[];
  let mine: Task[];
  try {
    all = JSON.parse(field("all") || "[]");
    mine = JSON.parse(field("mine") || "[]");
  } catch {
    return `${host}: lineclear task list did not give JSON`;
  }
  const max = field("max") === "" ? undefined : Number(field("max"));
  return {
    host,
    tasks: mine.map((t) => ({ ...t, ...(t.id ? { id: `${t.id}@${host}` } : {}), sub: t.sub ? `${t.sub} · on ${host}` : `on ${host}` })),
    working: all.filter((t) => t.status === "work").length,
    max,
    load,
    loadLimit: limit,
    slotsBusy: Number(field("busy")) || 0,
    slots,
    ...(build ? { apart: buildApart(host, field("build").split(" "), build) } : {}),
  };
}

/** One machine's room and tasks now, over SSH; a text when it cannot be reached. */
export function readRoom(host: string, space: string, env: Env = process.env, mine?: { version: string; commit: string }): Room | string {
  try {
    const p = Bun.spawnSync(sshArgs(env, host, readScript(space)), { stdin: "ignore", timeout: TIMEOUT_MS, env: env as Record<string, string> });
    if (p.exitCode !== 0) return `${host} cannot be reached: ${(p.stderr.toString() || p.stdout.toString()).trim().split("\n").at(-1) || `exit ${p.exitCode}`}`;
    return parseRoom(host, p.stdout.toString(), mine);
  } catch (e) {
    return `${host} cannot be reached: ${(e as Error).message}`;
  }
}

/**
 * The tasks of a project's other machines, for the views. The rule loop writes what each machine said into the
 * project's state at every tick, so a view never waits on SSH, and a machine that is down still shows its last tasks.
 */
export function remoteTasks(space: string, env: Env = process.env): Task[] {
  for (const name of listProjectNames(env as NodeJS.ProcessEnv)) {
    const s = readSettings(name, env as NodeJS.ProcessEnv);
    if (typeof s === "string" || s.space !== space || !s.machines?.length) continue;
    try {
      const seen = JSON.parse(readFileSync(join(projectsDir(env as NodeJS.ProcessEnv), name, "state.json"), "utf8")).remoteSeen ?? {};
      return s.machines.flatMap((h) => (Array.isArray(seen[h]) ? (seen[h] as Task[]) : []));
    } catch {
      return [];
    }
  }
  return [];
}

/** The folder of a project's clone on the other machine, named after its space. */
const cloneDir = (space: string) => `$HOME/code/${space}`;

/** Clones the repo once, checks its origin, and brings it up to date when it is clean on main. */
const cloneScript = (origin: string, dir: string) => `D="${dir}"
if [ ! -d "$D/.git" ]; then mkdir -p "$(dirname "$D")"; git clone -q ${quote(origin)} "$D"; fi
[ "$(git -C "$D" remote get-url origin)" = ${quote(origin)} ] || { echo "$D has another origin than ${origin.replace(/["\\$`]/g, "")}" >&2; exit 1; }
git -C "$D" fetch -q origin
if [ "$(git -C "$D" symbolic-ref --short HEAD 2>/dev/null)" = main ] && [ -z "$(git -C "$D" status --porcelain)" ]; then git -C "$D" merge -q --ff-only origin/main; fi
`;

const startScript = (space: string, origin: string, dir: string) => `set -e
${REMOTE_PATH}
S=${REMOTE_SHEPHERDR}
${cloneScript(origin, dir)}"$S" space list | grep -q "^${space.replace(/[^A-Za-z0-9_-]/g, "")}  " || "$S" space add "$D" --name ${quote(space)} >/dev/null
if [ -n "$PROJECT" ] && [ ! -f "$HOME/.config/lineclear/projects/$PROJECT/settings.json" ] && [ -x "$HOME/.local/bin/lineclear" ]; then "$HOME/.local/bin/lineclear" project add "$D" --name "$PROJECT" --space ${quote(space)} --check "$CHECK" >/dev/null 2>&1 || true; fi
BRIEF="$(cat)"
exec "$S" task add "$TITLE" --brief "$BRIEF" --space ${quote(space)} "$@"
`;

/**
 * Puts the project's secrets into the other machine's vault over SSH, at the level of the space the task runs in.
 * They travel on stdin, never in an argument or a log. Returns an error text, or undefined (also when there are none).
 */
function sendSecrets(host: string, project: string, space: string, env: Env = process.env): string | undefined {
  const text = secretsText(project, env, host);
  if (text === "") return undefined;
  const script = `"$HOME/.local/bin/lineclear" secrets import ${quote(space)} >/dev/null`;
  try {
    const p = Bun.spawnSync(sshArgs(env, host, `sh -c ${quote(script)}`), { stdin: Buffer.from(text), timeout: 60_000, env: env as Record<string, string> });
    return p.exitCode === 0 ? undefined : `its secrets did not arrive: ${(p.stderr.toString() || `exit ${p.exitCode}`).trim().split("\n").at(-1)}`;
  } catch (e) {
    return `its secrets did not arrive: ${(e as Error).message}`;
  }
}

/** Makes a task on another machine: clones the repo there once, adds the space, then `shepherdr task add`. Returns an error text, or undefined. */
export function startOn(
  host: string,
  space: string,
  origin: string,
  title: string,
  brief: string,
  extra: string[],
  env: Env = process.env,
  project?: { name: string; check: string },
): string | undefined {
  if (project) {
    const sent = sendSecrets(host, project.name, space, env);
    if (sent) return sent;
  }
  const script = `TITLE=${quote(title)}; PROJECT=${quote(project?.name ?? "")}; CHECK=${quote(project?.check ?? "")}; ${startScript(space, origin, cloneDir(space))}`;
  return runScript(host, `sh -c ${quote(script)} sh ${extra.map(quote).join(" ")}`, brief, env);
}

/** Runs a command on a machine with stdin. Returns the last lines of its error, or undefined when it succeeded. */
function runScript(host: string, command: string, stdin: string, env: Env): string | undefined {
  try {
    const p = Bun.spawnSync(sshArgs(env, host, command), { stdin: Buffer.from(stdin), timeout: 5 * 60_000, env: env as Record<string, string> });
    return p.exitCode === 0 ? undefined : (p.stderr.toString() || p.stdout.toString()).trim().split("\n").slice(-3).join(" ") || `exit ${p.exitCode}`;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Clones a project's repo on a machine, or brings it up to date, with no task. Returns an error text, or undefined. */
export function cloneOn(host: string, space: string, origin: string, env: Env = process.env): string | undefined {
  return runScript(host, `sh -c ${quote(`set -e\n${REMOTE_PATH}\n${cloneScript(origin, cloneDir(space))}`)}`, "", env);
}
