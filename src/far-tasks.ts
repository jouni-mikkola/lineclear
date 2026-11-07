import type { Env, HomeTask, TaskState } from "./home-data.ts";
import { stageSince, stepOf, taskStage } from "./home-stage.ts";
import { notReached, remoteTasks } from "./spread.ts";

type Raw = any;

/** A remote task's state line without the "on <machine>" tail the spread adds (`parseRoom` in spread.ts). */
const withoutTail = (sub: string | undefined) => sub?.replace(/(?: · )?on [^ ]+$/, "") || undefined;

/** Tasks that run on the project's other machines show beside the local ones. */
export function farTasks(space: Raw, env: Env, now: number): HomeTask[] {
  return remoteTasks(space.name, env)
    .filter((t) => t.id && (t.status === "work" || t.status === "need" || t.status === "queued"))
    .map((t): HomeTask => {
      // a silent machine's task is only what it said last: it is not waiting for you now
      const state = (t.silentSince !== undefined && t.status === "need" ? "work" : t.status) as TaskState;
      const step = stepOf(t.title);
      const line = withoutTail(t.sub);
      const stage = taskStage({}, state, line);
      const since = stageSince({ id: String(t.id) }, stage, now);
      return {
        id: String(t.id),
        title: t.title,
        state,
        stage,
        ...(state === "need" && line ? { text: line } : {}),
        ...(step ? { step } : {}),
        machine: String(t.id).split("@")[1],
        since,
        at: since,
        ...(t.silentSince !== undefined
          ? {
              silentSince: t.silentSince,
              last: {
                text: notReached(String(t.id).split("@")[1] ?? "", t.silentSince),
                at: t.silentSince,
              },
            }
          : {}),
      };
    });
}
