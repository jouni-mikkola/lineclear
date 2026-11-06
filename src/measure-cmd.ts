import { readJson } from "../pi/config.ts";
import { lineclearDir, spaceTasks } from "./measure.ts";
import { type SessionCalls, phaseTable, readCpu, taskPhases, worktreeCalls } from "./measure-phases.ts";
import { readMachines } from "./machine-list.ts";
import { remoteLineclearSync } from "./ssh.ts";
import { join } from "node:path";

type Env = Record<string, string | undefined>;
type Out = (l: string) => void;

const USAGE = "usage: lineclear measure phases [--last N]";

/** The last `n` tasks that had a working folder, newest first, from every space. */
function lastTasks(dir: string, n: number): { id: string; worktree: string; machine?: string }[] {
  const spaces: { key: string }[] = readJson(join(dir, "spaces.json")) ?? [];
  return spaces
    .flatMap((s) => spaceTasks(dir, s, true))
    .filter((t) => t.worktree)
    .sort((a, b) => b.created - a.created)
    .slice(0, n)
    .map((t) => ({ id: String(t.id), worktree: String(t.worktree), machine: t.machine }));
}

/** The session calls of working folders on another machine, asked over SSH; none when it cannot be reached. */
function remoteCalls(host: string, worktrees: string[], env: Env): Record<string, SessionCalls[]> {
  const r = remoteLineclearSync(host, ["measure", "calls", ...worktrees], env, 60_000);
  try {
    return r.code === 0 ? JSON.parse(r.stdout) : {};
  } catch {
    return {};
  }
}

export function measureMain(args: string[], out: Out, env: Env = process.env): number {
  if (args[0] === "calls") {
    // the part of `phases` that runs on the machine holding the session logs
    out(JSON.stringify(Object.fromEntries(args.slice(1).map((w) => [w, worktreeCalls(w, env)]))));
    return 0;
  }
  const i = args.indexOf("--last");
  const last = i >= 0 ? Number(args[i + 1]) : 30;
  if (args[0] !== "phases" || !(last > 0) || args.some((a, n) => n > 0 && a !== "--last" && n !== i + 1)) {
    out(USAGE);
    return 2;
  }
  const dir = lineclearDir(env);
  const tasks = lastTasks(dir, last);
  const hosts = new Set(readMachines(env).map((m) => m.host));
  const remote = new Map<string, Record<string, SessionCalls[]>>();
  for (const host of hosts) {
    const own = tasks.filter((t) => t.machine === host).map((t) => t.worktree);
    if (own.length) remote.set(host, remoteCalls(host, own, env));
  }
  const rows = tasks.flatMap((t) => {
    const sessions = t.machine && hosts.has(t.machine) ? (remote.get(t.machine)?.[t.worktree] ?? []) : worktreeCalls(t.worktree, env);
    return sessions.some((s) => s.calls.length) ? [taskPhases(t.id, sessions, readCpu(dir, t.id))] : [];
  });
  for (const l of phaseTable(rows)) out(l);
  return 0;
}
