import { readJson } from "../pi/config.ts";
import { readChatLogs } from "./chat-kept.ts";
import { dataDir, piDir } from "./paths.ts";
import { readRetiredKept, readTasksKept } from "./tasks-kept.ts";
import { join } from "node:path";
import { readSessions } from "./harness-pi.ts";
import { reviewerRound, sessionUsage, type Usage } from "./session-text.ts";

export { sessionFolder } from "./harness-pi.ts";

type Env = Record<string, string | undefined>;

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tiers?: (Partial<Price> & { inputTokensAbove: number })[];
}

/** The equivalent $ of one message. Prices are per million tokens. A tier applies when the prompt is above its size. */
export function costOf(u: Usage, p: Price): number {
  return Object.values(costByCause(u, p)).reduce((a, b) => a + b, 0);
}

/** The causes of a step's cost: the kinds of token it is paid for. */
const CAUSES = ["input", "output", "cacheRead", "cacheWrite"] as const;
type Cause = (typeof CAUSES)[number];
type CauseCosts = Record<Cause, number>;

/** The dollars of one message by kind of token; they sum to `costOf`. */
function costByCause(u: Usage, p: Price): CauseCosts {
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  let rate: Price = p;
  for (const t of p.tiers ?? []) {
    if (prompt > t.inputTokensAbove) rate = { ...p, ...t };
  }
  const dollars = (cause: Cause) => (u[cause] * rate[cause]) / 1e6;
  return { input: dollars("input"), output: dollars("output"), cacheRead: dollars("cacheRead"), cacheWrite: dollars("cacheWrite") };
}

// ---- reading the files ----

export function lineclearDir(env: Env): string {
  return dataDir(env);
}

/** The space of a project: its entry in spaces.json, by name, key or folder. */
export function findSpace(dir: string, space: string, repo: string): { name: string; key: string } | undefined {
  const spaces: any[] = readJson(join(dir, "spaces.json")) ?? [];
  const s = spaces.find((x) => x.name === space || x.key === space || x.path === repo);
  return s ? { name: s.name, key: s.key } : undefined;
}

/** A space's tasks: the live rows, and with `retired`, the retired ones; each once. */
export function spaceTasks(dir: string, space: { key: string }, retired = false): any[] {
  const raw: any[] = readTasksKept(dir).tasks;
  const live = Array.isArray(raw) ? raw : Object.values(raw);
  // a task retired twice (a stop between the two writes) or still in tasks.json counts once
  const byId = new Map([...(retired ? readRetiredKept(dir) : []), ...live].map((t) => [String(t.id), t] as const));
  return [...byId.values()].filter((t) => String(t.id).startsWith(`${space.key}-`));
}

/** The chat logs of a space's tasks, with the ones of retired tasks in archive/chatlog. `coordinatorOnly`: just the space's coordinator chat. */
export function chatFiles(dir: string, space: { name: string; key: string }, coordinatorOnly = false): any[] {
  const own = (f: string) => (!coordinatorOnly && f.startsWith(`${space.key}-`)) || (f.startsWith("p_") && f.endsWith(`_${space.name}`));
  return [false, ...(coordinatorOnly ? [] : [true])].flatMap((archived) =>
    readChatLogs(dir, archived)
      .filter((c) => own(c.name))
      .map((c) => c.log),
  );
}

/** The start of a task is its first "started" card, else the time it was made if it has a worktree, else it never started. */
export function taskStart(task: any, files: any[]): number | undefined {
  let start: number | undefined;
  for (const f of files) {
    for (const p of f.posted ?? []) {
      if (p?.card?.task === task.id && p.card.status === "work" && String(p.card.id).startsWith("go:")) {
        start = Math.min(start ?? Infinity, p.at);
      }
    }
  }
  return start ?? (task.worktree ? task.created : undefined);
}

/** The usage of a working folder's pi sessions, or undefined when none were found. */
function worktreeUsage(worktree: string, env: Env): Usage[] | undefined {
  const texts = readSessions(worktree, env);
  if (texts.length === 0) return undefined;
  let count = 0;
  return texts.flatMap((t) => {
    const named = reviewerRound(t);
    if (named === undefined) return sessionUsage(t);
    count++;
    const round = named || count;
    return sessionUsage(t).map((u) => ({ ...u, role: "reviewer" as const, round }));
  });
}

/** What a working folder's sessions cost at the same prices the usage charts use; undefined when no session was found or a model has no price. */
export function worktreeCost(worktree: string, env: Env): number | undefined {
  const usage = worktreeUsage(worktree, env);
  if (!usage) return undefined;
  const priceOf = priceFinder(readJson(join(piDir(env), "models-store.json")));
  let total = 0;
  for (const u of usage) {
    const price = priceOf(u);
    if (!price) return undefined;
    total += costOf(u, price);
  }
  return total;
}

/** Tokens a working folder's sessions sent to the model, fresh and read from cache; undefined when no session was found. */
export function worktreeInput(worktree: string, env: Env): number | undefined {
  return worktreeUsage(worktree, env)?.reduce((n, u) => n + u.input + u.cacheRead, 0);
}

/** The price of the same model in pi's model data: the same provider first, then any provider. */
export function priceFinder(store: any): (u: Usage) => Price | undefined {
  const find = (provider: string | undefined, model: string): Price | undefined => {
    for (const [name, group] of Object.entries<any>(store ?? {})) {
      if (provider !== undefined && name !== provider) continue;
      const hit = (group?.models ?? []).find((x: any) => x.id === model && x.cost);
      if (hit) return hit.cost;
    }
    return undefined;
  };
  return (u) => find(u.provider, u.model) ?? find(undefined, u.model);
}
