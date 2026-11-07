import type { Env, HomeTask, TaskState } from "./home-data.ts";
import { stageSince, stepOf, taskStage } from "./home-stage.ts";
import { machineTasksShown } from "./task-read.ts";

type Raw = any;

/** A remote task's state line without the "on <machine>" tail the spread adds (`parseRoom` in spread.ts). */
const withoutTail = (sub: string | undefined) => sub?.replace(/(?: · )?on [^ ]+$/, "") || undefined;

/** Tasks that run on the project's other machines show beside the local ones. */
export function farTasks(space: Raw, env: Env, now: number): HomeTask[] {
  return machineTasksShown(env, space.name)
    .filter((t) => t.id && (t.status === "work" || t.status === "need" || t.status === "queued"))
    .map((t): HomeTask => {
      const state = t.status as TaskState;
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
      };
    });
}
