// Compaction near 150 k for every model, and the compaction point of each role. pi compacts when the context passes `window - reserveTokens`, per model in
// `compaction.modelOverrides` of its settings. This sets each known model's reserve from its window, and a short tail.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { writeAtomic } from "./atomic.ts";
import { configDir, readJson } from "./config.ts";
import { turnedOff } from "./pack.ts";

type Env = Record<string, string | undefined>;

/** Where compaction should start, in tokens. */
const TARGET = 150_000;
/** The tail kept after a compaction, when the user has set none. */
const TAIL = 20_000;
/** The least reserve: a window just above the target still keeps room for the answer. */
const MIN_RESERVE = 16_384;

const piDir = (env: Env) => env.PI_CODING_AGENT_DIR || join(env.HOME ?? homedir(), ".pi", "agent");
const settingsFile = (env: Env = process.env) => join(piDir(env), "settings.json");
/** The values this pack wrote, so a later run can tell them from yours. */
const writtenFile = (env: Env = process.env) => join(configDir(env), "pack-compaction.json");

/** Every model pi knows, as `provider/id` with its window (null when unknown). */
function models(env: Env = process.env): { key: string; window: number | null }[] {
  const out = new Map<string, number | null>();
  const add = (provider: string, list: unknown) => {
    for (const m of Array.isArray(list) ? list : []) {
      if (typeof m?.id !== "string") continue;
      const w = m.contextWindow;
      out.set(`${provider}/${m.id}`, typeof w === "number" && w > 0 ? w : null);
    }
  };
  for (const [provider, v] of Object.entries(readJson(join(piDir(env), "models-store.json")) ?? {})) add(provider, (v as any)?.models);
  for (const [provider, v] of Object.entries(readJson(join(piDir(env), "models.json"))?.providers ?? {})) add(provider, (v as any)?.models);
  return [...out].map(([key, window]) => ({ key, window })).sort((a, b) => a.key.localeCompare(b.key));
}

/** The models whose window is unknown: they are left as they are. */
export const unknownWindows = (env: Env = process.env) =>
  models(env)
    .filter((m) => m.window === null)
    .map((m) => m.key);

/** The reserve that makes a window compact near the target, or null when the window is not above it. */
export const reserveFor = (window: number) => (window > TARGET ? Math.max(MIN_RESERVE, window - TARGET) : null);

/** Writes the reserves and the tail into pi's settings. A value you set stays. Returns the models it set. */
export function applyCompaction(env: Env = process.env): string[] {
  const file = settingsFile(env);
  if (!existsSync(file)) return [];
  const settings = readJson(file);
  if (!settings || typeof settings !== "object") return [];
  const written: Record<string, number> = readJson(writtenFile(env)) ?? {};
  const compaction = (settings.compaction ??= {});
  const overrides = (compaction.modelOverrides ??= {});
  const set: string[] = [];
  for (const { key, window } of models(env)) {
    const reserve = window === null ? null : reserveFor(window);
    if (reserve === null) continue;
    const have = overrides[key]?.reserveTokens;
    if (have !== undefined && have !== written[key]) continue; // yours
    if (have === reserve) continue;
    overrides[key] = { ...overrides[key], reserveTokens: reserve };
    written[key] = reserve;
    set.push(key);
  }
  let changed = set.length > 0;
  if (compaction.keepRecentTokens === undefined) {
    compaction.keepRecentTokens = TAIL;
    changed = true;
  }
  if (!changed) return set;
  writeAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
  mkdirSync(dirname(writtenFile(env)), { recursive: true });
  writeAtomic(writtenFile(env), `${JSON.stringify(written, null, 2)}\n`);
  return set;
}

/** True in the Dispatcher: its role is set, or it runs in its folder (<config>/dispatcher). */
function inDispatcher(cwd: string, env: Env): boolean {
  if (env.LINECLEAR_ROLE === "dispatcher") return true;
  const dir = join(configDir(env), "dispatcher");
  return cwd === dir || cwd.startsWith(`${dir}/`);
}

/** The roles that get a compaction point of their own. */
type Role = "worker" | "reviewer" | "coordinator" | "dispatcher";

/**
 * Where each role compacts, in tokens, unless `<config>/pack.json` says otherwise under `compaction`. First try from the
 * band table of `lineclear measure` (two thirds of the cost is spent above 50k of context): 60 to 80k.
 */
const ROLE_POINTS: Record<Role, number> = { worker: 80_000, reviewer: 70_000, coordinator: 70_000, dispatcher: 60_000 };

/** The switch of the part that applies the role points: off, every role compacts at the global target. */
const ROLE_PART = "compaction-point";

/** A task's agent is a worker, its reviewer a reviewer, any other chat identity (a space key) a coordinator, the Dispatcher (its role is set, or it runs in its folder) its own; no role, none. */
function roleOf(env: Env = process.env, cwd: string = process.cwd()): Role | undefined {
  if (inDispatcher(cwd, env)) return "dispatcher";
  const chat = env.LINECLEAR_CHAT ?? "";
  if (!chat) return undefined;
  if (chat.endsWith("/Agent")) return "worker";
  if (chat.endsWith("/Reviewer")) return "reviewer";
  return "coordinator";
}

/** The token count at which this session's role compacts, or undefined when it has no role or the part is off. */
export function rolePoint(env: Env = process.env, cwd: string = process.cwd()): number | undefined {
  const role = roleOf(env, cwd);
  if (!role || turnedOff(env).includes(ROLE_PART)) return undefined;
  const own = readJson(join(configDir(env), "pack.json"))?.compaction?.[role];
  return typeof own === "number" && own > 0 ? own : ROLE_POINTS[role];
}
