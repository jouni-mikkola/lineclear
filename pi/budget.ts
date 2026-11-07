// A token budget per role (docs/plan/flow.md), summed from `message.usage` at each turn end. Cache reads are left out:
// they are cheap, and the budget is for new input.
import { inDispatcher } from "./fresh-dispatcher.ts";

type Raw = any;
type Env = Record<string, string | undefined>;
type Pi = {
  on: (event: string, handler: (event: Raw, ctx: Raw) => unknown) => void;
  sendUserMessage?: (text: string, options?: { deliverAs?: "steer" | "followUp" }) => unknown;
};

type Role = "agent" | "reviewer" | "chat" | "dispatcher";
type Budget = { budget: number; cap?: number };

/** New input a role may use. Only a role with a cap is stopped; a chat compacts at its budget and goes on. */
const BUDGETS: Record<Role, Budget> = {
  agent: { budget: 150_000, cap: 400_000 },
  reviewer: { budget: 15_000, cap: 50_000 },
  chat: { budget: 1_000_000 },
  dispatcher: { budget: 500_000 },
};

/** The role of this pi, or undefined for a hand-run pi, which has no budget. */
function budgetRole(env: Env, cwd: string): Role | undefined {
  if (inDispatcher(cwd, env)) return "dispatcher";
  const chat = env.LINECLEAR_CHAT;
  if (!chat) return undefined;
  if (!chat.includes("/")) return "chat";
  return /\/Reviewer$/.test(chat) ? "reviewer" : "agent";
}

/** The role's budget; `LINECLEAR_BUDGET_<ROLE>` replaces it (the cap stays, or follows when it is lower). */
function budgetFor(role: Role, env: Env): Budget {
  const base = BUDGETS[role];
  const set = Number(env[`LINECLEAR_BUDGET_${role.toUpperCase()}`]);
  if (!(set > 0)) return base;
  return { budget: set, cap: base.cap === undefined ? undefined : Math.max(base.cap, set) };
}

const newInput = (usage: Raw): number => (Number(usage?.input) || 0) + (Number(usage?.cacheWrite) || 0);

export default function budget(pi: Pi, env: Env = process.env): void {
  const role = budgetRole(env, process.cwd());
  if (!role) return;
  const { budget: limit, cap } = budgetFor(role, env);
  let used = 0;
  let compacted = false;
  let told = false;
  let stopped = false;
  pi.on("turn_end", (event, ctx) => {
    try {
      if (event?.message?.role !== "assistant") return;
      used += newInput(event.message.usage);
      if (cap !== undefined && used >= cap) {
        if (!stopped) {
          stopped = true;
          ctx.abort();
        }
        return;
      }
      if (used >= limit && !told && cap !== undefined) {
        told = true;
        pi.sendUserMessage?.("Token budget used up. Finish now, or declare a wait and end your turn.", {
          deliverAs: "steer",
        });
      }
      if (used >= limit * 0.8 && !compacted) {
        compacted = true;
        ctx.compact();
      }
    } catch {
      // a budget must never break a turn
    }
  });
}
