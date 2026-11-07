import { join, resolve } from "node:path";
import { readJson } from "../pi/config.ts";
import { listProjectNames, projectsDir, readSettings } from "./project.ts";
import { unprovenOf } from "./doneproof.ts";
import { ownerStepsDone } from "./owner-steps.ts";
import { doneIds, parseRoadmap, type Step, type StepStatus, stepStatuses, type Task } from "./roadmap.ts";
import type { State } from "./rules.ts";

type Env = Record<string, string | undefined>;
type Commits = { subject: string; body: string }[];

/** The rule loop's record of a repo's project, as the loop last saved it; undefined when no project has the repo. */
function stateOf(repo: string, env: Env): Partial<State> | undefined {
  for (const name of listProjectNames(env)) {
    const settings = readSettings(name, env);
    if (typeof settings === "string" || resolve(settings.repo) !== resolve(repo)) continue;
    return (readJson(join(projectsDir(env), name, "state.json")) as Partial<State> | undefined) ?? {};
  }
  return undefined;
}

/** The step each task of a repo's project was started for, from the rules' record; empty when the rules have none. */
const taskStepsOf = (repo: string, env: Env): Record<string, string> => stateOf(repo, env)?.taskSteps ?? {};

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

/** The steps merged to main (the commits' subjects) or closed with nothing to merge. */
function mergedSteps(steps: Step[], commits: Commits, closed: Record<string, string> | undefined): Set<string> {
  const ids = new Set(steps.map((s) => s.id));
  const merged = doneIds(commits, ids);
  for (const id of Object.keys(closed ?? {})) if (ids.has(id)) merged.add(id);
  return merged;
}

/** What `stepStatuses` reads. */
export interface StepInputs {
  merged: Set<string>;
  tasks: Task[];
  taskSteps: Record<string, string>;
  remote: Task[];
  unproven: ReadonlyMap<string, string>;
}

/**
 * The one place the inputs of `stepStatuses` are gathered, so the rule loop, `roadmap status`, Home and the views
 * give a step the same state: main, the closed steps, the owner's hand entries, the tasks here and on other machines,
 * and the checker's proof records. The loop passes its live `state` and `unproven`; a reader takes the saved ones.
 */
export function stepInputs(
  steps: Step[],
  commits: Commits,
  tasks: { local: Task[]; remote: Task[] },
  repo: string,
  env: Env,
  live: { state: Partial<State>; unproven?: ReadonlyMap<string, string> } = { state: stateOf(repo, env) ?? {} },
): StepInputs {
  const { state } = live;
  const merged = mergedSteps(steps, commits, state.closedSteps);
  for (const id of ownerStepsDone(env, state, steps)) merged.add(id);
  return { merged, tasks: tasks.local, taskSteps: state.taskSteps ?? {}, remote: tasks.remote, unproven: live.unproven ?? unprovenOf(repo, env) };
}

/** The states of steps from gathered inputs: the only call of `stepStatuses` outside the roadmap module. */
export function statusesFrom(steps: Step[], i: StepInputs): StepStatus[] {
  return stepStatuses(steps, i.merged, i.tasks, i.taskSteps, i.remote, i.unproven);
}

/** The states of a repo's steps: a local task marks its step only through the rules' record, a task of another machine through its title. */
export function statusesOf(steps: Step[], commits: Commits, tasks: Task[], repo: string, env: Env): StepStatus[] {
  const i = stepInputs(steps, commits, { local: tasks.filter((t) => !isRemote(t)), remote: tasks.filter(isRemote) }, repo, env);
  return statusesFrom(steps, i);
}

/** The merged steps and the unproven ones of a roadmap's text, for a reader that draws the plan and not the states. */
export function planInputs(text: string, commits: Commits, repo: string, env: Env): { merged: Set<string>; unproven: ReadonlyMap<string, string> } {
  const { merged, unproven } = stepInputs(parseRoadmap(text).steps, commits, { local: [], remote: [] }, repo, env);
  return { merged, unproven };
}
