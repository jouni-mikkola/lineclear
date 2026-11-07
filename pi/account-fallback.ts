// When an account is full, the run goes on at once on the next model of the project's list, in the same pi process.
// One virtual model per role (lineclear/worker, lineclear/reviewer, lineclear/planner) routes over the ordered list in the
// project's settings (docs/virtual-models.md in pi). A paid API key stays off because only listed models are ever used.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { configDir } from "./config.ts";

type Env = Record<string, string | undefined>;
type Raw = any;
export type Lists = Record<string, string[]>;

/** The error text claude-bridge writes when a subscription is full. */
const QUOTA = /Claude quota exceeded|hit your [a-z0-9 -]*limit/i;
/** How long a model counts as full: the error text names no reset time worth parsing. */
export const HOLD_MS = 60 * 60_000;
const PROVIDER = "lineclear";
const ROLES = ["worker", "reviewer", "planner"];

export const isQuotaError = (text: unknown): boolean => typeof text === "string" && QUOTA.test(text);

/** The main checkout a folder belongs to: its own `.git` folder, or the one a worktree's `.git` file points to. Undefined outside git. */
function repoOf(cwd: string): string | undefined {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const dot = join(dir, ".git");
    try {
      if (statSync(dot).isDirectory()) return dir;
      const target = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, "utf8"))?.[1];
      // <repo>/.git/worktrees/<name>
      return target ? dirname(dirname(dirname(resolve(dir, target.trim())))) : undefined;
    } catch {
      // no .git here: look in the parent
    }
    if (dirname(dir) === dir) return undefined;
  }
}

/** The ordered model lists of the project whose repo holds `cwd` (LINECLEAR_PROJECT names it when set). Empty when none. */
export function projectLists(cwd: string, env: Env = process.env): Lists {
  const dir = join(configDir(env), "projects");
  const repo = repoOf(cwd);
  const names = env.LINECLEAR_PROJECT ? [env.LINECLEAR_PROJECT] : existsSync(dir) ? safeList(dir) : [];
  for (const name of names) {
    try {
      const s = JSON.parse(readFileSync(join(dir, name, "settings.json"), "utf8"));
      if (!env.LINECLEAR_PROJECT && (!repo || resolve(s.repo) !== repo)) continue;
      const out: Lists = {};
      for (const role of ROLES) if (Array.isArray(s.models?.[role]) && s.models[role].length > 0) out[role] = s.models[role].map(String);
      return out;
    } catch {
      // a project that cannot be read is not this one
    }
  }
  return {};
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** The role whose list holds `spec` ("provider/id"), in the order worker, reviewer, planner. */
export const roleOf = (lists: Lists, spec: string): string | undefined => ROLES.find((r) => lists[r]?.includes(spec));

/**
 * The next model to ask: `want` if it is not full, else the first of the list that is not. The whole list full gives
 * `want` or the first entry, so the run ends in the real error instead of a silent loop.
 */
export function pick(list: string[], full: Map<string, number>, now: number, want?: string): string {
  const free = (m: string) => (full.get(m) ?? 0) <= now;
  if (want && list.includes(want) && free(want)) return want;
  return list.find(free) ?? want ?? (list[0] as string);
}

const find = (ctx: Raw, spec: string) => {
  const slash = spec.indexOf("/");
  return slash > 0 ? ctx.modelRegistry.find(spec.slice(0, slash), spec.slice(slash + 1)) : undefined;
};

export default function accountFallback(pi: Raw, env: Env = process.env, now: () => number = Date.now): void {
  if (typeof pi.registerVirtualModel !== "function") return;
  const lists = projectLists(process.cwd(), env);
  const full = new Map<string, number>();
  // the model the process started on: the board's picker chose it, so the first request keeps it unless it is full
  const started: Record<string, string | undefined> = {};
  for (const role of Object.keys(lists)) {
    pi.registerVirtualModel({
      provider: PROVIDER,
      id: role,
      name: `Lineclear ${role}`,
      thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
      route(request: Raw, ctx: Raw) {
        const spec = (m: Raw) => `${m.provider}/${m.id}`;
        if (request.failed && isQuotaError(request.failed.message?.errorMessage)) full.set(spec(request.failed.model), now() + HOLD_MS);
        const sticky = request.failed ?? request.previous;
        const want = sticky ? spec(sticky.model) : started[role];
        const choice = pick(lists[role] as string[], full, now(), want);
        const model = find(ctx, choice) ?? sticky?.model;
        if (!model) throw new Error(`pi has no model ${choice}`);
        return { model, thinkingLevel: sticky?.thinkingLevel ?? request.thinkingLevel };
      },
    });
  }
  pi.on("session_start", async (_event: Raw, ctx: Raw) => {
    // never let the fallback stop an agent
    try {
      const m = ctx.model;
      if (!m || m.provider === PROVIDER) return;
      const role = roleOf(lists, `${m.provider}/${m.id}`);
      if (!role) return;
      started[role] = `${m.provider}/${m.id}`;
      const virtual = ctx.modelRegistry.find(PROVIDER, role);
      if (virtual) await pi.setModel(virtual);
    } catch {
      // the run goes on on the model it has
    }
  });
}
