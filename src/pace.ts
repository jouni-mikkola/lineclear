import { providerOf } from "./full.ts";
import { paceOf, roomPerDay, usageLimits, WEEK_DAYS } from "./limits.ts";
import type { State, Step } from "./roadmap.ts";

/**
 * The models with the ones on pace first and the most room a day first (a tie keeps the settings' order), and the
 * models whose account is ahead of its pace. An account that reports no week is neutral.
 */
export function rankByRoom(models: string[], env: NodeJS.ProcessEnv, now: Date): { order: string[]; ahead: Set<string> } {
  const usage = new Map(usageLimits(models.map(providerOf), env, now.getTime()).map((u) => [u.account, u]));
  const stand = (m: string) => {
    const w = usage.get(providerOf(m))?.week;
    const room = roomPerDay(w, now.getTime());
    return { ahead: paceOf(w, now.getTime()) === "ahead", room: room ?? 100 / WEEK_DAYS };
  };
  const order = models
    .map((m, i) => ({ m, i, ...stand(m) }))
    .sort((a, b) => Number(a.ahead) - Number(b.ahead) || b.room - a.room || a.i - b.i)
    .map((x) => x.m);
  return { order, ahead: new Set(models.filter((m) => stand(m).ahead)) };
}

/** The first of the models that is usable, by room a day, and whether its account is ahead of its pace. */
export function firstByRoom(models: string[], usable: (model: string) => boolean, env: NodeJS.ProcessEnv, now: Date): { worker?: string; ahead: boolean } {
  const { order, ahead } = rankByRoom(models, env, now);
  const worker = order.find(usable);
  return { worker, ahead: worker !== undefined && ahead.has(worker) };
}

/**
 * The ready steps that head the longest chain of steps still waiting on them: when every account is ahead of its
 * pace, only these start, as the rest can wait without delaying the end.
 */
export function criticalSteps(steps: Step[], status: { id: string; state: State }[]): Set<string> {
  const open = new Set(status.filter((s) => s.state !== "done" && s.state !== "dropped").map((s) => s.id));
  const after = new Map(steps.map((s) => [s.id, s.after.filter((a) => open.has(a))]));
  const memo = new Map<string, number>();
  const tail = (id: string): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, 0);
    let longest = 0;
    for (const [other, deps] of after) if (open.has(other) && deps.includes(id)) longest = Math.max(longest, 1 + tail(other));
    memo.set(id, longest);
    return longest;
  };
  const ready = status.filter((s) => s.state === "ready").map((s) => s.id);
  const longest = Math.max(0, ...ready.map(tail));
  return new Set(ready.filter((id) => tail(id) === longest));
}
