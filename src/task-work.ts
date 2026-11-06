// What a task runs besides its checks (its agent, a review, the step check, the done proof) is written to decisions.jsonl
// with the machine it ran on, so `lineclear measure` can count the runs per machine next to check-runs.jsonl's.
// A task stays on the machine it was started on: work found on another one is a fault.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type CheckRun, machineOf } from "./check-runs.ts";

type Env = Record<string, string | undefined>;

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

/** One line of work done for `task` on this machine (or `machine` when the server acts for another). */
export function recordWork(task: string, work: Work, env: Env = process.env, machine = machineOf(env)): void {
  const file = decisionsFile(env);
  mkdirSync(dirname(file), { recursive: true });
  const line: WorkLine = { time: new Date().toISOString(), project: "-", step: task, kind: "run", work, machine, reason: `${work} ran on ${machine}` };
  appendFileSync(file, `${JSON.stringify(line)}\n`);
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

/** Runs counted per machine, most first. A check run from before runs named a machine counts for `main`. */
export function runsPerMachine(runs: CheckRun[], work: WorkLine[], main: string): [string, number][] {
  const count = new Map<string, number>();
  for (const m of [...runs.map((r) => r.machine ?? main), ...work.map((w) => w.machine)]) count.set(m, (count.get(m) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The runs and work done on a machine other than their task's. `home` gives a task's machine by its branch (a check run) or id (a line of work). */
export function strayRuns(runs: CheckRun[], work: WorkLine[], home: (key: string) => string | undefined): string[] {
  const stray = (key: string, machine: string, what: string) => {
    const at = home(key);
    return at !== undefined && at !== machine ? [`${what} of ${key} ran on ${machine}, its task is on ${at}`] : [];
  };
  return [...runs.flatMap((r) => stray(r.branch, r.machine ?? "", `${r.tier} check`)), ...work.flatMap((w) => stray(w.step, w.machine, w.work))];
}

/** The `measure` line: runs per machine. */
export function machineRunLine(counts: [string, number][]): string {
  return counts.length === 0 ? "runs per machine: none" : `runs per machine: ${counts.map(([m, n]) => `${m} ${n}`).join(", ")}`;
}
