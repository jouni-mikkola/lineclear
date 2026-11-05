import { availability } from "./stalls.ts";
import { readAccounts } from "./full.ts";
import { usageLimits } from "./limits.ts";
import { unknownAdapter } from "./quota.ts";

/** Whether a model of a role's list is used now: `use` starts the next task, `next` waits its turn, `full` and `key` are passed over. */
type ModelUse = "use" | "next" | "full" | "key";

export interface ModelReason {
  state: ModelUse;
  /** Why, in words: "in use", "account full until 16:00", "next if the ones above are full". */
  reason: string;
}

const clock = (at: Date) => `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;

/**
 * Why each model of a role's list is or is not used right now. The first model whose account has room is in use; the
 * ones above it are passed over for the reason given, the ones below wait for their turn. A model whose account reports
 * no limit says so, so "in use" never hides that nothing watches it.
 */
export function modelReasons(models: string[], env: NodeJS.ProcessEnv = process.env, now = new Date()): ModelReason[] {
  const accounts = readAccounts(env);
  const unreported = new Set(
    usageLimits(
      models.map((m) => m.split("/")[0] ?? ""),
      env,
      now.getTime(),
    )
      .filter((u) => u.unreported)
      .map((u) => u.account),
  );
  let chosen = false;
  return models.map((m): ModelReason => {
    const provider = m.split("/")[0] ?? "";
    const av = availability(m, env, now);
    if (av === "out") {
      const until = accounts[provider]?.resetAt;
      const at = until ? new Date(until) : undefined;
      const day = at && at.toDateString() !== now.toDateString() ? ` ${at.toLocaleDateString("en", { weekday: "short" })}` : "";
      return { state: "full", reason: at ? `account full until${day} ${clock(at)}` : "account full" };
    }
    if (av === "key") return { state: "key", reason: "paid key waits for your leave in the Inbox" };
    const { calls, limited } = unknownAdapter.counts(provider, env, now.getTime());
    const note = unreported.has(provider) ? `, usage not reported${calls > 0 ? ` (${calls} calls, ${limited} limited)` : ""}` : "";
    if (!chosen) {
      chosen = true;
      return { state: "use", reason: `in use${note}` };
    }
    return { state: "next", reason: `next, takes over when the ones above are full${note}` };
  });
}

/** Why a task runs on a model that is not in its project's list for that role, or nothing when it is. */
export function modelNote(model: string, list: string[], by: "coordinator" | "task" = "coordinator"): string | undefined {
  return list.includes(model) ? undefined : `set by ${by}: not in the project's list`;
}
