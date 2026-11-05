import { join, resolve } from "node:path";
import { readJson } from "../pi/config.ts";
import { listProjectNames, projectsDir, readSettings } from "./project.ts";
import { type Step, type StepStatus, stepStatuses, type Task } from "./roadmap.ts";

type Env = Record<string, string | undefined>;

/** The step each task of a repo's project was started for, from the rules' record; empty when the rules have none. */
function taskStepsOf(repo: string, env: Env): Record<string, string> {
  for (const name of listProjectNames(env)) {
    const settings = readSettings(name, env);
    if (typeof settings === "string" || resolve(settings.repo) !== resolve(repo)) continue;
    const state = readJson(join(projectsDir(env), name, "state.json")) as { taskSteps?: Record<string, string> } | undefined;
    return state?.taskSteps ?? {};
  }
  return {};
}

/** Another machine's task: its id ends in `@host`, and the rules hold no record of it, so its title names its step. */
const isRemote = (t: Task) => t.id?.includes("@") === true;

/** The step a task was started for: the rules' record for a local task, its title for another machine's. */
function stepIdOfTask(steps: Step[], t: Task, recorded: Record<string, string>): string | undefined {
  if (isRemote(t)) return steps.find((s) => t.title.startsWith(`${s.id} `))?.id;
  return t.id === undefined ? undefined : recorded[t.id];
}

/** The task of each step in the view: an open one first. */
export function taskOfStep<T extends Task>(steps: Step[], tasks: T[], repo: string, env: Env): (id: string) => T | undefined {
  const recorded = taskStepsOf(repo, env);
  return (id) => {
    const own = tasks.filter((t) => stepIdOfTask(steps, t, recorded) === id);
    return own.find((t) => t.status !== "done") ?? own[0];
  };
}

/** Tasks titled by the step the rules started them for, so title-based readers see the record: a local task with none is left out. */
export function titledByStep<T extends { id?: string; title: string }>(repo: string, tasks: T[], env: Env): T[] {
  const recorded = taskStepsOf(repo, env);
  return tasks.flatMap((t) => {
    if (t.id?.includes("@")) return [t];
    const step = t.id === undefined ? undefined : recorded[t.id];
    return step === undefined ? [] : [{ ...t, title: `${step} ${t.title}` }];
  });
}

/** The states of a repo's steps: a local task marks its step only through the rules' record, a task of another machine through its title. */
export function statusesOf(steps: Step[], done: Set<string>, tasks: Task[], repo: string, env: Env, unproven: ReadonlyMap<string, string>): StepStatus[] {
  return stepStatuses(
    steps,
    done,
    tasks.filter((t) => !isRemote(t)),
    taskStepsOf(repo, env),
    tasks.filter(isRemote),
    unproven,
  );
}
