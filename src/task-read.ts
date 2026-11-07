import { serverBin } from "./paths.ts";
import type { Task } from "./roadmap.ts";

type Env = Record<string, string | undefined>;
type Listed = Task & { machine?: string; space?: string };
type Read = { tasks: Listed[] } | { why: string };

// One `task list --json` serves every caller: each spawn is a new process and the board serializes every task into it.
// A read is kept for a few seconds, and until a command changes a task (`forgetTaskReads`), so a tick, Home's
// every-second polls and the helpers share it. Filtering by space is done here.
const KEEP_MS = 3000;
const kept = new Map<string, { at: number; read: Read }>();

/** Forget what was read: a task has changed, or a new tick starts. */
export const forgetTaskReads = () => kept.clear();

function readList(args: string[], env: Env): Read {
  const key = [serverBin(env), env.LINECLEAR_URL, env.HOME, ...args].join("\0");
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.read;
  let read: Read;
  try {
    const p = Bun.spawnSync([serverBin(env), "task", "list", ...args, "--json"], { stdin: "ignore", env: env as NodeJS.ProcessEnv, timeout: 10_000 });
    read = p.exitCode === 0 ? { tasks: JSON.parse(p.stdout.toString()) as Listed[] } : { why: (p.stderr.toString() || p.stdout.toString()).trim() };
  } catch {
    read = { why: "did not give JSON" };
  }
  kept.set(key, { at: Date.now(), read });
  return read;
}

/** What a tick reads once: `lineclear` reads until a command changes a task, and the memos until the next tick. */
export function readers<R>(run: (cmd: string[]) => R) {
  // `lineclear task list` and `show` each start a process of their own: read each once, until a command changes a task.
  let reads = new Map<string, R>();
  // chat files and main's refs are read once a tick: the ladder and the stall detectors both look at them
  let memos = new Map<string, unknown>();
  return {
    read(cmd: string[]) {
      const key = cmd.join("\0");
      const r = reads.get(key) ?? run(cmd);
      reads.set(key, r);
      return r;
    },
    change(cmd: string[]) {
      reads = new Map();
      forgetTaskReads();
      return run(cmd);
    },
    memo<T>(key: string, f: () => T): T {
      return (memos.has(key) ? memos.get(key) : memos.set(key, f()).get(key)) as T;
    },
    newTick() {
      reads = new Map();
      forgetTaskReads();
      memos = new Map();
    },
  };
}

/** The tasks the one server keeps for another machine, from the list a tick has read already; a text when it cannot be read. */
export function readMachineTasks(env: Env, host: string): { tasks: Listed[] } | { why: string } {
  const all = readList([], env);
  return "tasks" in all ? { tasks: all.tasks.filter((t) => t.machine === host) } : all;
}

/**
 * This machine's tasks of one space, or of every space. The all-spaces list is read once and filtered here. A board
 * that does not name the space in its tasks (an older one, a stand-in), or fails to list them all, is asked for the
 * space itself.
 */
export function readTasks(env: Env, space?: string, archived = false): { tasks: Task[] } | { why: string } {
  const flag = archived ? ["--archived"] : [];
  const all = readList(flag, env);
  if (space === undefined) return "tasks" in all ? { tasks: all.tasks.filter((t) => !t.machine) } : all;
  if ("tasks" in all && (all.tasks.length === 0 || all.tasks.some((t) => t.space !== undefined))) {
    return { tasks: all.tasks.filter((t) => !t.machine && t.space === space) };
  }
  return readList(["--space", space, ...flag], env);
}
