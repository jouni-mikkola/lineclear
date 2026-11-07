// What a task runs (its agent, a review, the step check, the done proof) is written to the decisions table
// with the machine it ran on.
// A task stays on the machine it was started on: work found on another one is a fault.
import { hostname } from "node:os";
import { addDecisionOnce, decisionsSince } from "./decisions-store.ts";

type Env = Record<string, string | undefined>;

/** The machine this runs on: LINECLEAR_MACHINE, else the host name, as a folder name. */
export const machineOf = (env: Env = process.env) =>
  ((env.LINECLEAR_MACHINE ?? "").split(".")[0] || hostname().split(".")[0] || "machine").replace(/[^A-Za-z0-9._-]+/g, "_");

export type Work = "agent" | "review" | "stepcheck" | "doneproof";

export interface WorkLine {
  time: string;
  project: string;
  /** the task the work is for */
  step: string;
  kind: "run";
  work: Work;
  machine: string;
  reason: string;
}

const REPEAT_SPAN_MS = 30 * 60_000;

/** One line of work done for `task` on this machine (or `machine` when the server acts for another). The same line again in the same half hour is not written (a unique key): a tick that starts the same agent over and over is one fact. */
export function recordWork(task: string, work: Work, env: Env = process.env, machine = machineOf(env), now = Date.now()): void {
  const line: WorkLine = { time: new Date(now).toISOString(), project: "-", step: task, kind: "run", work, machine, reason: `${work} ran on ${machine}` };
  addDecisionOnce(env, line, `${task}|${work}|${machine}|${Math.floor(now / REPEAT_SPAN_MS)}`);
}

const REVIEW_SPAN_MS = 30 * 60_000;

/** A reviewer's first `lineclear` call in half an hour is the review running on this machine: the chat identity `<task>/Reviewer` names the task. */
export function recordReviewCall(env: Env = process.env, now = Date.now()): void {
  const task = /^([\w.-]+)\/Reviewer$/.exec(env.LINECLEAR_CHAT ?? "")?.[1];
  if (!task) return;
  const here = machineOf(env);
  if (
    readWork(env, now - REVIEW_SPAN_MS).some((w) => w.work === "review" && w.step === task && w.machine === here && now - Date.parse(w.time) < REVIEW_SPAN_MS)
  )
    return;
  recordWork(task, "review", env);
}

export function readWork(env: Env = process.env, since = 0): WorkLine[] {
  return decisionsSince<WorkLine>(env, since).filter((d) => d.kind === "run" && d.work && d.machine);
}
