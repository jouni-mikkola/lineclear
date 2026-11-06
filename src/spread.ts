import { machineLimits, slotsHeld } from "../server/server/live/engine/check-queue.ts";
import { serverBin } from "./paths.ts";
import { listProjectNames, projectsDir, readSettings } from "./project.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Task } from "./roadmap.ts";
import { quote, REMOTE_PATH, sshArgs } from "./ssh.ts";
import { secretsText } from "./secrets.ts";

type Env = Record<string, string | undefined>;

// A project's steps may run on other machines. There is one server and one task store: a machine's room is what the
// server says of it (herdr's read, its tasks at work, its slots). A machine that cannot be reached is a text, never a throw.

const TIMEOUT_MS = 40_000;
/** A machine with less memory free than this takes no new task. */
const MIN_FREE_KB = 1024 * 1024;

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
  /** Free memory in KiB, as herdr reads it there. */
  freeKb?: number;
}

/** A machine that has not answered for this long loses its known tasks from the views. */
export const SILENT_DROP_MS = 24 * 60 * 60 * 1000;

/** One machine's reads: when it last answered, whether the last read went unanswered, and whether its tasks were dropped for it. */
export interface MachineRead {
  good: number;
  missed?: true;
  dropped?: true;
}

/**
 * Asks each machine for its room once. One that cannot be reached is skipped, but still holds what it last ran: its
 * known tasks keep their locks and steps. The state's `remoteSeen` is the project's memory of that and `machineReads` of when each
 * machine last answered, both updated here. After a day of silence the views drop its tasks (noted once with the tasks it dropped).
 */
export function askMachines(
  hosts: string[],
  state: { remoteSeen?: Record<string, Task[]>; machineReads?: Record<string, MachineRead> },
  now: number,
  room: (host: string) => Room | string,
  note: (host: string, why: string) => void,
) {
  const seen = (state.remoteSeen ??= {});
  const reads = (state.machineReads ??= {});
  for (const host of Object.keys(seen)) if (!hosts.includes(host)) delete seen[host];
  for (const host of Object.keys(reads)) if (!hosts.includes(host)) delete reads[host];
  const rooms = new Map<string, Room>();
  const remote: Task[] = [];
  for (const host of hosts) {
    const r = room(host);
    if (typeof r === "string") {
      const known = (seen[host] ?? []).filter((t) => t.status !== "done");
      note(host, `machine ${host} skipped: ${r}${known.length > 0 ? `; its ${known.length} known open tasks still count` : ""}`);
      remote.push(...(seen[host] ?? []));
      const read = (reads[host] ??= { good: now });
      read.missed = true;
      if (!read.dropped && now - read.good >= SILENT_DROP_MS) {
        read.dropped = true;
        const names = known.map((t) => t.id ?? t.title);
        note(
          host,
          `machine ${host} has not answered since ${new Date(read.good).toISOString()}: its ${names.length} known tasks leave the views and the count${names.length > 0 ? ` (${names.join(", ")})` : ""}`,
        );
      }
    } else {
      rooms.set(host, r);
      seen[host] = r.tasks;
      reads[host] = { good: now };
      remote.push(...r.tasks);
    }
  }
  return { rooms, remote };
}

/** Why the machine takes no new task now, or undefined when it has room. */
export function roomLack(r: Room): string | undefined {
  if (r.max === undefined) return "cannot read its slots from the server";
  if (r.working >= r.max) return `no free slot (${r.working} of ${r.max} working)`;
  if (r.load > r.loadLimit) return `load average ${r.load.toFixed(1)} is above its limit of ${r.loadLimit}`;
  if (r.freeKb !== undefined && r.freeKb < MIN_FREE_KB) return `only ${Math.round(r.freeKb / 1024)} MiB of memory is free (it needs ${MIN_FREE_KB / 1024})`;
  if (r.slotsBusy >= r.slots) return `all ${r.slots} check slots are in use`;
  return undefined;
}

/** What `lineclear room <machine>` says: the adapter's read of the machine, with its tasks at work and its slots from the one store. */
interface RoomRead {
  load: number;
  cores: number;
  freeKb: number;
  working: number;
  max: number | null;
}

/** Runs one command of the one server and parses its JSON; a text when it fails. */
function serverJson<T>(env: Env, args: string[]): T | string {
  try {
    const p = Bun.spawnSync([serverBin(env as NodeJS.ProcessEnv), ...args], { stdin: "ignore", timeout: TIMEOUT_MS, env: env as Record<string, string> });
    const text = p.stdout.toString();
    if (p.exitCode !== 0) return (p.stderr.toString() || text).trim().split("\n").at(-1) || `exit ${p.exitCode}`;
    return JSON.parse(text) as T;
  } catch (e) {
    return (e as Error).message;
  }
}

/** One machine's room and its tasks now, from the one server (herdr's read and the task store); a text when it cannot be reached. */
export function readRoom(host: string, space: string, env: Env = process.env): Room | string {
  const read = serverJson<RoomRead>(env, ["room", host]);
  if (typeof read === "string") return `${host} cannot be reached: ${read}`;
  const list = serverJson<(Task & { machine?: string })[]>(env, ["task", "list", "--space", space, "--json"]);
  if (typeof list === "string") return `${host}: task list failed: ${list}`;
  const { slots, loadLimit } = machineLimits({ ...env, LINECLEAR_CORES: String(read.cores) });
  return {
    host,
    tasks: list
      .filter((t) => t.machine === host)
      .map((t) => ({ ...t, ...(t.id ? { id: `${t.id}@${host}` } : {}), sub: t.sub ? `${t.sub} · on ${host}` : `on ${host}` })),
    working: read.working,
    max: read.max ?? undefined,
    load: read.load,
    loadLimit,
    slotsBusy: slotsHeld({ ...env, LINECLEAR_MACHINE: host }),
    slots,
    freeKb: read.freeKb,
  };
}

/** What a view says of a machine that did not answer its last read; `good` is the time of its last good one (ms). */
export const notReached = (host: string, good: number) => `${host} not reached since ${new Date(good).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** What the rule loop knows of a space's other machines: their tasks as last said and when each last answered. */
function remoteMemory(space: string, env: Env): { seen: Record<string, Task[]>; reads: Record<string, MachineRead>; hosts: string[] } {
  const none = { seen: {}, reads: {}, hosts: [] };
  for (const name of listProjectNames(env as NodeJS.ProcessEnv)) {
    const s = readSettings(name, env as NodeJS.ProcessEnv);
    if (typeof s === "string" || s.space !== space || !s.machines?.length) continue;
    try {
      const state = JSON.parse(readFileSync(join(projectsDir(env as NodeJS.ProcessEnv), name, "state.json"), "utf8"));
      return { seen: state.remoteSeen ?? {}, reads: state.machineReads ?? {}, hosts: s.machines };
    } catch {
      return none;
    }
  }
  return none;
}

/** The machines that did not answer their last read, each with when it last did (ms), across every project. */
export function silentMachines(env: Env = process.env): Map<string, number> {
  const out = new Map<string, number>();
  for (const name of listProjectNames(env as NodeJS.ProcessEnv)) {
    try {
      const state = JSON.parse(readFileSync(join(projectsDir(env as NodeJS.ProcessEnv), name, "state.json"), "utf8"));
      for (const [host, r] of Object.entries((state.machineReads ?? {}) as Record<string, MachineRead>))
        if (r.missed) out.set(host, Math.max(out.get(host) ?? 0, r.good));
    } catch {
      // a project with no state yet has read no machine
    }
  }
  return out;
}

/**
 * The tasks of a project's other machines, for the views. The rule loop writes what each machine said into the
 * project's state at every tick, so a view never waits on the server. A machine that is down still shows its last tasks,
 * each with `silentSince` (ms of its last good read) while it does not answer, and none once it was silent for a day.
 */
export function remoteTasks(space: string, env: Env = process.env): (Task & { silentSince?: number })[] {
  const { seen, reads, hosts } = remoteMemory(space, env);
  return hosts.flatMap((h) => {
    const read = reads[h];
    if (read?.dropped || !Array.isArray(seen[h])) return [];
    return (seen[h] as Task[]).map((t) => (read?.missed ? { ...t, silentSince: read.good } : t));
  });
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

/** Makes a task on another machine: refreshes the repo clone there, then the one server adds the task with `task add --on`. Returns an error text, or undefined. */
export function startOn(
  host: string,
  space: string,
  origin: string,
  title: string,
  brief: string,
  extra: string[],
  env: Env = process.env,
  project?: { name: string },
): string | undefined {
  if (project) {
    const sent = sendSecrets(host, project.name, space, env);
    if (sent) return sent;
  }
  const cloned = cloneOn(host, space, origin, env);
  if (cloned) return cloned;
  const p = Bun.spawnSync([serverBin(env as NodeJS.ProcessEnv), "task", "add", title, "--brief", brief, "--space", space, "--on", host, ...extra], {
    stdin: "ignore",
    timeout: 5 * 60_000,
    env: env as Record<string, string>,
  });
  return p.exitCode === 0 ? undefined : (p.stderr.toString() || p.stdout.toString()).trim().split("\n").slice(-3).join(" ") || `exit ${p.exitCode}`;
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
