// What a task runs (its agent, a review, the step check, the done proof) is written to decisions.jsonl
// with the machine it ran on.
// A task stays on the machine it was started on: work found on another one is a fault.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";

type Env = Record<string, string | undefined>;

/** The machine this runs on: LINECLEAR_MACHINE, else the host name, as a folder name. */
export const machineOf = (env: Env = process.env) =>
  ((env.LINECLEAR_MACHINE ?? "").split(".")[0] || hostname().split(".")[0] || "machine").replace(/[^A-Za-z0-9._-]+/g, "_");

// the file pi/config.ts's decisionsPath names; the check-line module may not import pi
const decisionsFile = (env: Env) => join(env.LINECLEAR_CONFIG ?? join(homedir(), ".config", "lineclear"), "decisions.jsonl");

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

/** The same work on the same machine within this span is one line: a caller that asks every tick writes once. */
const WORK_SPAN_MS = 30 * 60_000;

/** One line of work done for `task` on this machine (or `machine` when the server acts for another). */
export function recordWork(task: string, work: Work, env: Env = process.env, machine = machineOf(env), now = Date.now()): void {
  if (readWork(env).some((w) => w.work === work && w.step === task && w.machine === machine && now - Date.parse(w.time) < WORK_SPAN_MS)) return;
  const file = decisionsFile(env);
  mkdirSync(dirname(file), { recursive: true });
  const line: WorkLine = { time: new Date(now).toISOString(), project: "-", step: task, kind: "run", work, machine, reason: `${work} ran on ${machine}` };
  appendFileSync(file, `${JSON.stringify(line)}\n`);
}

/** A reviewer's first `lineclear` call in half an hour is the review running on this machine: the chat identity `<task>/Reviewer` names the task. */
export function recordReviewCall(env: Env = process.env, now = Date.now()): void {
  const task = /^([\w.-]+)\/Reviewer$/.exec(env.LINECLEAR_CHAT ?? "")?.[1];
  if (!task) return;
  recordWork(task, "review", env, machineOf(env), now);
}

export function readWork(env: Env = process.env): WorkLine[] {
  let text = "";
  try {
    text = readFileSync(decisionsFile(env), "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((l) => {
    try {
      const d = JSON.parse(l) as Partial<WorkLine>;
      return d.kind === "run" && d.work && d.machine ? [d as WorkLine] : [];
    } catch {
      return [];
    }
  });
}
