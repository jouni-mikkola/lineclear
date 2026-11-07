// The one answer to "what runs where": each running agent's task, machine, phase, input tokens, minutes and wait.
// Home's task table and `lineclear top` both read it, so they never differ.

/** The facts of a task that this view reads; a Home task and the UI's task both have them. */
export interface StatusTask {
  id: string;
  title: string;
  state: string;
  stage?: string;
  step?: string;
  machine?: string;
  since?: number;
  stalled?: boolean;
  silentSince?: number;
  text?: string;
  /** Tokens sent to the model so far: fresh and read from cache. */
  input?: number;
}

export interface StatusProject<T extends StatusTask = StatusTask> {
  name: string;
  tasks: T[];
}

export interface AgentRow {
  id: string;
  project: string;
  step: string;
  title: string;
  machine: string;
  /** where the task is on the line */
  phase: string;
  input?: number;
  minutes: number;
  /** What it waits for, or "" when it does not wait */
  wait: string;
}

const PHASE: Record<string, string> = { work: "at work", review: "in review", ready: "ready to merge" };

const waitOf = (t: StatusTask): string =>
  t.state === "need" ? (t.text ?? "waits for you") : t.silentSince ? "not reached" : t.stalled ? "no sign of life" : "";

/** Every agent at work or waiting on you, in the order of the projects, then the tasks of spaces with no project. */
export function agentStatus(projects: StatusProject[], loose: (StatusTask & { space: string })[] = [], host: string, now: number): AgentRow[] {
  const working = (t: StatusTask) => t.state === "need" || (t.state === "work" && t.stage !== "queued" && t.stage !== "done");
  const make = (project: string, t: StatusTask): AgentRow => ({
    id: t.id,
    project,
    step: t.step ?? "",
    title: t.title,
    machine: t.machine ?? host,
    phase: PHASE[t.stage ?? "work"] ?? "at work",
    ...(t.input !== undefined ? { input: t.input } : {}),
    minutes: t.since === undefined ? 0 : Math.max(0, Math.floor((now - t.since) / 60_000)),
    wait: waitOf(t),
  });
  return [...projects.flatMap((p) => p.tasks.filter(working).map((t) => make(p.name, t))), ...loose.filter(working).map((t) => make(t.space, t))];
}

/** The rows as aligned text lines, the head first. */
export function statusLines(rows: AgentRow[]): string[] {
  const head = ["task", "machine", "phase", "input", "min", "wait"];
  const cells = rows.map((r) => [r.step || r.id, r.machine, r.phase, r.input === undefined ? "-" : String(r.input), String(r.minutes), r.wait || "-"]);
  const widths = head.map((h, i) => Math.max(h.length, ...cells.map((c) => (c[i] ?? "").length)));
  const line = (c: string[]) =>
    c
      .map((x, i) => (i === 3 || i === 4 ? x.padStart(widths[i] ?? 0) : x.padEnd(widths[i] ?? 0)))
      .join("  ")
      .trimEnd();
  return rows.length ? [line(head), ...cells.map(line)] : ["No agent at work."];
}
