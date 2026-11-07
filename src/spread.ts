import { machineLimits } from "../server/server/live/engine/machine.ts";
import { serverBin } from "./paths.ts";
import { readMachineTasks } from "./task-read.ts";
import { listProjectNames, projectsDir, readSettings } from "./project.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Task } from "./roadmap.ts";
import { type Cmd, type Ran, runAll } from "./run-all.ts";
import { quote, REMOTE_PATH, sshArgs } from "./ssh.ts";
import { secretsText } from "../server/server/live/secrets.ts";

type Env = Record<string, string | undefined>;

// A project's steps may run on other machines. There is one server and one task store: a machine's room is what the
// server says of it (herdr's read, its tasks at work, its slots). A machine that cannot be reached is a text, never a throw.

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

/** A machine that could take a new task now: `host` is undefined for this machine. */
export interface Candidate {
  host: string | undefined;
  load: number;
  loadLimit: number;
  /** Task slots left. */
  free: number;
}

/** The candidate with the most room: the lowest load against its limit, then the most free task slots. The first of equals wins, so this machine goes first. */
export function mostRoom(candidates: Candidate[]): Candidate | undefined {
  const used = (c: Candidate) => c.load / c.loadLimit;
  const better = (c: Candidate, best: Candidate) => {
    if (Math.abs(used(best) - used(c)) > 0.05) return used(c) < used(best);
    return c.free > best.free;
  };
  return candidates.reduce<Candidate | undefined>((best, c) => (best === undefined || better(c, best) ? c : best), undefined);
}

/** Why the machine takes no new task now, or undefined when it has room. */
export function roomLack(r: Room): string | undefined {
  if (r.max === undefined) return "cannot read its slots from the server";
  if (r.working >= r.max) return `no free slot (${r.working} of ${r.max} working)`;
  if (r.load > r.loadLimit) return `load average ${r.load.toFixed(1)} is above its limit of ${r.loadLimit}`;
  if (r.freeKb !== undefined && r.freeKb < MIN_FREE_KB) return `only ${Math.round(r.freeKb / 1024)} MiB of memory is free (it needs ${MIN_FREE_KB / 1024})`;
  return undefined;
}

/** What a machine row of the main server's snapshot says: its worker's room and the slots the one store counts. */
interface MachineRow {
  machine: string;
  room?: { load: number; cores: number; freeKb: number };
  slots?: { working: number; max: number | null };
}

/** One machine's room and its tasks now, from the server's snapshot (its worker's own read, no process started) and the tick's task list; a text when it cannot be reached. */
export function readRoom(host: string, space: string, snapshot: unknown, env: Env = process.env): Room | string {
  const row = ((snapshot as { machines?: MachineRow[] } | undefined)?.machines ?? []).find((m) => m.machine === host);
  if (!row?.room || !row.slots) return `${host} cannot be reached: its worker has not reported its room`;
  const list = readMachineTasks(env, host);
  if ("why" in list) return `${host}: task list failed: ${list.why}`;
  const { loadLimit } = machineLimits({ ...env, LINECLEAR_CORES: String(row.room.cores) });
  return {
    host,
    tasks: list.tasks
      .filter((t) => t.space === undefined || t.space === space)
      .map((t) => ({ ...t, ...(t.id ? { id: `${t.id}@${host}` } : {}), sub: t.sub ? `${t.sub} · on ${host}` : `on ${host}` })),
    working: row.slots.working,
    max: row.slots.max ?? undefined,
    load: row.room.load,
    loadLimit,
    freeKb: row.room.freeKb,
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

/** A task to make: here when `host` is undefined, else on that machine of the project. */
export interface NewTask {
  host?: string;
  title: string;
  brief: string;
  extra: string[];
}

const ADD_TIMEOUT_MS = 5 * 60_000;

/** The last lines of a failed command, or undefined when it worked. */
const failure = (r: Ran) => (r.code === 0 ? undefined : (r.err || r.out).trim().split("\n").slice(-3).join(" ") || `exit ${r.code}`);

/**
 * What readies a machine for a project's tasks: the project's secrets put into its vault at the level of the space the
 * tasks run in (they travel on stdin, never in an argument or a log), and the repo clone there made or brought up to date.
 */
function readyCmds(host: string, space: string, origin: string, env: Env, project?: string): (Cmd & { why: string })[] {
  const clone = {
    argv: sshArgs(env, host, `set -e\n${REMOTE_PATH}\n${cloneScript(origin, cloneDir(space))}`),
    timeoutMs: ADD_TIMEOUT_MS,
    why: "",
  };
  const text = project === undefined ? "" : secretsText(project, env, host);
  if (text === "") return [clone];
  const script = `"$HOME/.local/bin/lineclear" secrets import ${quote(space)} >/dev/null`;
  return [{ argv: sshArgs(env, host, script), stdin: text, timeoutMs: 60_000, why: "its secrets did not arrive: " }, clone];
}

/**
 * Makes tasks here and on the other machines, all at once. Each machine that gets one is readied first (all machines
 * together), then the one server adds every task (`task add`, with `--on <host>` for another machine) together. One
 * error text, or undefined, per task. `origin` is undefined when the repo has none to clone elsewhere.
 */
export function addTasksAt(space: string, origin: string | undefined, tasks: NewTask[], env: Env = process.env, project?: string): (string | undefined)[] {
  const hosts = [...new Set(tasks.flatMap((t) => (t.host === undefined ? [] : [t.host])))];
  const notReady = new Map<string, string>();
  if (origin === undefined) for (const host of hosts) notReady.set(host, `the repo has no origin to clone on ${host}`);
  const ready = origin === undefined ? [] : hosts.flatMap((host) => readyCmds(host, space, origin, env, project).map((c) => ({ ...c, host })));
  runAll(ready, env).forEach((r, i) => {
    const { host, why } = ready[i] as (typeof ready)[number];
    const failed = failure(r);
    if (failed !== undefined && !notReady.has(host)) notReady.set(host, `${why}${failed}`);
  });
  const go = tasks.filter((t) => t.host === undefined || !notReady.has(t.host));
  const ran = runAll(
    go.map((t) => ({
      argv: [
        serverBin(env as NodeJS.ProcessEnv),
        "task",
        "add",
        t.title,
        "--brief",
        t.brief,
        "--space",
        space,
        ...(t.host === undefined ? [] : ["--on", t.host]),
        ...t.extra,
      ],
      timeoutMs: ADD_TIMEOUT_MS,
    })),
    env,
  );
  return tasks.map((t) => {
    const i = go.indexOf(t);
    return i < 0 ? notReady.get(t.host as string) : failure(ran[i] as Ran);
  });
}
