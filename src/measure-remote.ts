import type { Measured, Price, TaskInfo } from "./measure.ts";
import { readMachines } from "./machine-list.ts";
import { remoteLineclearSync } from "./ssh.ts";
import type { Usage } from "./session-text.ts";

type Env = Record<string, string | undefined>;

/** What `lineclear measure --raw` prints on a machine: its own tasks with their usage and prices, its asks and turns. */
export interface Raw {
  asks: number[];
  turns: number[];
  tasks: (TaskInfo & { usage?: Usage[]; prices: (Price | null)[]; parts: string[] })[];
}

/** One machine's raw work for a project, over SSH; a line saying why not when it cannot be read. */
function readRaw(host: string, project: string, since: string, env: Env): Raw | string {
  const r = remoteLineclearSync(host, ["measure", project, "--since", since, "--raw", "--local"], env, 120_000);
  if (r.code !== 0) return `${host} was not counted: it did not answer or has no project ${project}`;
  try {
    const raw = JSON.parse(r.stdout) as Raw;
    return Array.isArray(raw.tasks) && Array.isArray(raw.asks) && Array.isArray(raw.turns)
      ? raw
      : `${host} was not counted: its answer is not raw measure data`;
  } catch {
    return `${host} was not counted: its answer is not raw measure data`;
  }
}

/** This machine's measured inputs with the work of every machine in Settings added; `notes` lists the machines that could not be read. */
export function withMachines(local: Measured, project: string, since: string, env: Env): { measured: Measured; machines: string[]; notes: string[] } {
  const usages = new Map<string, Usage[] | undefined>();
  const prices = new Map<string, Map<Usage, Price | undefined>>();
  const parts = new Map<string, string[]>();
  const tasks = [...local.tasks];
  const asks = [...local.asks];
  const turns = [...(local.turns ?? [])];
  const machines: string[] = [];
  const notes: string[] = [];
  for (const { host } of readMachines(env)) {
    const raw = readRaw(host, project, since, env);
    if (typeof raw === "string") {
      notes.push(raw);
      continue;
    }
    machines.push(host);
    asks.push(...raw.asks);
    turns.push(...raw.turns);
    for (const { usage, prices: p, parts: pp, ...t } of raw.tasks) {
      const id = `${host}:${t.id}`;
      tasks.push({ ...t, id });
      usages.set(id, usage);
      parts.set(id, pp);
      prices.set(id, new Map((usage ?? []).map((u, i) => [u, p[i] ?? undefined])));
    }
  }
  const owner = (t: TaskInfo) => t.id;
  const measured: Measured = {
    ...local,
    tasks,
    asks,
    turns,
    usageOf: (t) => (usages.has(owner(t)) ? usages.get(owner(t)) : local.usageOf(t)),
    priceOf: (u) => {
      for (const m of prices.values()) if (m.has(u)) return m.get(u);
      return local.priceOf(u);
    },
    partsOf: (t) => (parts.has(owner(t)) ? (parts.get(owner(t)) as string[]) : (local.partsOf?.(t) ?? [])),
  };
  return { measured, machines, notes };
}
