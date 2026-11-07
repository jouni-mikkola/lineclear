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

const AGENT_REPEAT_MS = 10 * 60_000;
const agentWrittenAt = new Map<string, number>();

/** One line of work done for `task` on this machine (or `machine` when the server acts for another). An agent start the server asks for on every tick is written once per 10 minutes. */
export function recordWork(task: string, work: Work, env: Env = process.env, machine = machineOf(env)): void {
  if (work === "agent") {
    const key = `${decisionsFile(env)}|${task}|${machine}`;
    const now = Date.now();
    if (now - (agentWrittenAt.get(key) ?? 0) < AGENT_REPEAT_MS) return;
    agentWrittenAt.set(key, now);
  }
  const file = decisionsFile(env);
  mkdirSync(dirname(file), { recursive: true });
  const line: WorkLine = { time: new Date().toISOString(), project: "-", step: task, kind: "run", work, machine, reason: `${work} ran on ${machine}` };
  appendFileSync(file, `${JSON.stringify(line)}\n`);
}

const REVIEW_SPAN_MS = 30 * 60_000;

/** A reviewer's first `lineclear` call in half an hour is the review running on this machine: the chat identity `<task>/Reviewer` names the task. */
export function recordReviewCall(env: Env = process.env, now = Date.now()): void {
  const task = /^([\w.-]+)\/Reviewer$/.exec(env.LINECLEAR_CHAT ?? "")?.[1];
  if (!task) return;
  const here = machineOf(env);
  if (readWork(env).some((w) => w.work === "review" && w.step === task && w.machine === here && now - Date.parse(w.time) < REVIEW_SPAN_MS)) return;
  recordWork(task, "review", env);
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
