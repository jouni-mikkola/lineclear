import { localSpaceBySlug, stepMarks } from "./home-data.ts";
import { stopsOfSpace } from "./home-waits.ts";
import { readSettings } from "./project.ts";
import { stepParts } from "./parts.ts";
import { countSteps, currentPhase, lineOf, type Plan, readPlan, type RoadmapLine } from "./progress.ts";
import { roadmapSource, lineclearTasks } from "./roadmap-source.ts";
import { checkRoadmap, doneIds, resultOf, type State, type Task } from "./roadmap.ts";
import { planInputs, statusesOf, taskOfStep, titledByStep } from "./task-steps.ts";

/** What the Roadmap view draws for one project: its steps with their states, tasks and commits, and its merges. */
export interface RoadmapData {
  project: string;
  /** The phases in the roadmap's order. */
  phases: string[];
  steps: RoadmapStep[];
  /** Steps done and steps in all (a dropped step is in neither), the numbers Home shows. */
  done: number;
  total: number;
  /** The roadmap in one line: the counts, the estimated finish and what keeps it from coming sooner. */
  line: RoadmapLine;
  /** The phase the project is in: the first with an open step. Absent when every step is done. */
  phase?: string;
  /** Commits on origin/main that mark a step done, newest first. */
  history: { step: string; at: number; commit: string; subject: string }[];
  /** The Inbox asks of this project that wait for you, newest first. The server adds them, so a read of the files has none. */
  decisions?: { n: number; question: string; step?: string }[];
  /** Each part the steps name, with its health score (higher is worse). Absent when none is given. */
  parts?: { name: string; score: number }[];
  /** Review rounds a step's task may use before it asks you. */
  rounds: number;
  /** Why the tasks could not be read: the steps then show no task. */
  tasksError?: string;
  /** Paused: the rules start none of the project's steps. Absent means Running. */
  paused?: boolean;
}

export interface RoadmapStep {
  /** For an unproven step: the first `done when` item that is not proven. */
  unproven?: string;
  id: string;
  title: string;
  /** What the owner or a user can see or do once the step lands: one sentence. Empty when the roadmap has none. */
  result: string;
  phase: string;
  state: State;
  why: string;
  doneWhen: string;
  locks: string[];
  /** The parts the step names. */
  parts?: string[];
  after: string[];
  dropped?: string;
  /** The task whose title starts with the step's id: an open one first, else the first in Lineclear's list. */
  task?: { id?: string; status: string; sub?: string; stalled?: boolean };
  commits: { commit: string; subject: string; at: number }[];
}

export type RoadmapRead = { ok: RoadmapData } | { error: string; status: number; file?: string; lines?: string[] };

type Env = Record<string, string | undefined>;
const HISTORY = 50;

/** The line of one roadmap, the same for the view, the CLI and Home: the open tasks mark their steps, the space's waits hold them. */
export function lineOfRoadmap(repo: string, space: string, tasks: Task[], env: Env, now: number): RoadmapLine | undefined {
  const source = roadmapSource(repo);
  if (!source) return undefined;
  const marks = stepMarks(
    titledByStep(
      repo,
      tasks.filter((t) => t.status !== "done"),
      env,
    ),
  );
  const { merged, unproven } = planInputs(source.text, source.commits, repo, env);
  return lineOf(source.text, source.commits, marks, stopsOfSpace(space, env), now, 0, unproven, merged).line;
}

/** A roadmap of Now, Next and Later lists: each list a phase, each item a step with no task or dependency. */
function listRoadmap(project: string, plan: Plan, line: RoadmapLine, rounds: number, read: Task[] | string): RoadmapData {
  const steps = plan.steps.map(
    (s): RoadmapStep => ({
      id: s.id,
      title: s.title,
      result: s.result ?? "",
      phase: s.phase,
      state: s.done ? "done" : "ready",
      why: "",
      doneWhen: "",
      locks: [],
      after: [],
      commits: [],
    }),
  );
  return {
    project,
    phases: [...new Set(plan.steps.map((s) => s.phase))],
    steps,
    ...countSteps(plan),
    line,
    ...(currentPhase(plan) ? { phase: currentPhase(plan) } : {}),
    history: [],
    decisions: [],
    rounds,
    ...(typeof read === "string" ? { tasksError: read } : {}),
  };
}

/** A Lineclear project by its name, else any space Lineclear lists on this machine by its slug. */
export function projectSettings(project: string, env: Env): { repo: string; space: string; reviewRounds?: number; paused?: boolean } | undefined {
  const own = readSettings(project, env);
  if (typeof own !== "string") return own;
  const space = localSpaceBySlug(project, env);
  return space ? { repo: space.path, space: space.name, reviewRounds: undefined } : undefined;
}

/**
 * One project's roadmap as `lineclear roadmap status` and the rule loop read it: the file on origin/main (or the
 * folder's own when origin has none), done from the commits on the same ref, and in work from the space's tasks.
 */
export function roadmapData(
  project: string,
  env: Env = process.env,
  tasksOf: (space: string) => Task[] | string = (s) => lineclearTasks(s, env),
  now = Date.now(),
): RoadmapRead {
  const settings = projectSettings(project, env);
  if (!settings) return { error: `There is no project named ${project}.`, status: 404 };
  const source = roadmapSource(settings.repo);
  if (!source) return { error: `${project} has no roadmap: docs/ROADMAP.md is missing.`, status: 404 };
  const { text, commits } = source;
  const line = (read: Task[] | string) => lineOfRoadmap(settings.repo, settings.space, typeof read === "string" ? [] : read, env, now) as RoadmapLine;
  const { parsed, errors } = checkRoadmap(text);
  // no step ids: Now, Next and Later lists, each list a phase and each item a step that has no task or dependency
  if (parsed.steps.length === 0 && errors.length === 0) {
    const plan = readPlan(text, commits);
    if (plan.steps.length > 0) {
      const read = tasksOf(settings.space);
      return { ok: { ...listRoadmap(project, plan, line(read), settings.reviewRounds ?? 2, read), ...(settings.paused ? { paused: true } : {}) } };
    }
  }
  if (errors.length)
    return {
      error: `The roadmap of ${project} does not pass its check.`,
      status: 422,
      file: "docs/ROADMAP.md",
      lines: errors.map((e) => `line ${e.line}: ${e.message}`),
    };

  const ids = new Set(parsed.steps.map((s) => s.id));
  const marks = commits.map((c) => ({ c, steps: [...doneIds([c], ids)] }));

  const read = tasksOf(settings.space);
  const tasks = typeof read === "string" ? [] : read;
  const states = statusesOf(parsed.steps, commits, tasks, settings.repo, env);
  const taskOf = taskOfStep(parsed.steps, tasks, settings.repo, env);
  const phases = [...new Set(parsed.steps.map((s) => s.phase))];
  const steps = parsed.steps.map((s, i): RoadmapStep => {
    const f = s.fields;
    const doneWhen = [f["done when"]?.value ?? "", ...(f["done when"]?.more ?? [])].filter((l) => l.trim() !== "").join("\n");
    const task = taskOf(s.id);
    const stated = states[i] as (typeof states)[number];
    return {
      id: s.id,
      title: s.title,
      result: resultOf(s),
      phase: s.phase,
      state: stated.state,
      ...(stated.unproven === undefined ? {} : { unproven: stated.unproven }),
      why: [f.why?.value ?? "", ...(f.why?.more ?? []).map((l) => l.trim())].join(" ").trim(),
      doneWhen,
      ...(stepParts(s).names.length ? { parts: stepParts(s).names } : {}),
      locks: (f.locks?.value ?? "").split(/[,\s]+/).filter((l) => l !== "" && l !== "none"),
      after: s.after.filter((a) => a !== "none"),
      ...(s.dropped ? { dropped: f.dropped?.value.trim() || "no longer wanted" } : {}),
      ...(task
        ? {
            task: {
              ...(task.id ? { id: task.id } : {}),
              status: task.status,
              ...(task.sub ? { sub: task.sub } : {}),
              ...(typeof task.stalled?.life === "number" && task.status !== "done" ? { stalled: true } : {}),
            },
          }
        : {}),
      commits: marks.filter((m) => m.steps.includes(s.id)).map(({ c }) => ({ commit: c.commit, subject: c.subject, at: c.at })),
    };
  });
  const history = marks
    .filter((m) => m.steps.length)
    .flatMap(({ c, steps }) => steps.map((step) => ({ step, at: c.at, commit: c.commit, subject: c.subject })))
    .slice(0, HISTORY);
  const inputs = planInputs(text, commits, settings.repo, env);
  const plan = readPlan(text, commits, inputs.unproven, inputs.merged);
  return {
    ok: {
      project,
      phases,
      steps,
      ...countSteps(plan),
      line: line(read),
      ...(currentPhase(plan) ? { phase: currentPhase(plan) } : {}),
      history,
      decisions: [],
      rounds: settings.reviewRounds ?? 2,
      ...(typeof read === "string" ? { tasksError: read } : {}),
      ...(settings.paused ? { paused: true } : {}),
    },
  };
}
