import { DAY } from "./measure.ts";

/** A stored task as `refiles` reads it. */
export interface FixInput {
  id: string;
  title?: string;
  project?: string;
  created?: number;
  doneAt?: number;
  merged?: boolean;
}

type Cause = "first" | "missed open" | "open elsewhere" | "ended merged" | "ended unmerged";

interface Fix {
  id: string;
  step: string;
  machine: string;
  form: "fix-first" | "id-first";
  created: number;
  doneAt?: number;
  merged: boolean;
}

export interface StepRefiles {
  step: string;
  mostIn24h: number;
  endedUnmerged: number;
  fixes: { id: string; machine: string; created: number; cause: Cause }[];
}

/** The machine a task's project (`p:<machine>:<name>`) is on. */
function machineOf(project: string | undefined): string {
  const parts = (project ?? "").split(":");
  return parts[0] === "p" && parts.length >= 3 ? (parts[1] as string) : "local";
}

/** A task as a step's fix task, by its title `Fix <id> <title>` or `<id> Fix: <title>`; undefined for any other task. */
function asFix(t: FixInput, steps: Set<string>): Fix | undefined {
  const title = t.title ?? "";
  const first = /^Fix (\S+) /.exec(title)?.[1];
  const second = /^(\S+) Fix: /.exec(title)?.[1];
  const step = first !== undefined && steps.has(first) ? first : second !== undefined && steps.has(second) ? second : undefined;
  if (step === undefined || typeof t.created !== "number") return undefined;
  return {
    id: t.id,
    step,
    machine: machineOf(t.project),
    form: step === first ? "fix-first" : "id-first",
    created: t.created,
    doneAt: typeof t.doneAt === "number" ? t.doneAt : undefined,
    merged: t.merged === true,
  };
}

/** The most fix tasks created inside any 24 hours; `times` sorted. */
function mostIn24h(times: number[]): number {
  let most = 0;
  let from = 0;
  for (let i = 0; i < times.length; i++) {
    while ((times[i] as number) - (times[from] as number) >= DAY) from++;
    most = Math.max(most, i - from + 1);
  }
  return most;
}

/** Why a fix task was filed, read against the step's fix task created just before it. */
function causeOf(fix: Fix, before: Fix | undefined): Cause {
  if (before === undefined) return "first";
  if (before.doneAt === undefined || before.doneAt >= fix.created) {
    return before.machine === fix.machine && before.form === fix.form ? "missed open" : "open elsewhere";
  }
  return before.merged ? "ended merged" : "ended unmerged";
}

/**
 * Per step with two or more fix tasks created in one rolling 24 hours of [from, now]: the most in 24 hours, how many
 * of its fix tasks created in the period ended unmerged, and a cause for each. Largest first.
 */
export function refiles(tasks: FixInput[], stepIds: string[], from: number, now: number): StepRefiles[] {
  const steps = new Set(stepIds);
  const byStep = new Map<string, Fix[]>();
  for (const t of tasks) {
    const fix = asFix(t, steps);
    if (fix) byStep.set(fix.step, [...(byStep.get(fix.step) ?? []), fix]);
  }
  const out: StepRefiles[] = [];
  for (const [step, all] of byStep) {
    all.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
    const inPeriod = all.filter((f) => f.created >= from && f.created <= now);
    const most = mostIn24h(inPeriod.map((f) => f.created));
    if (most < 2) continue;
    out.push({
      step,
      mostIn24h: most,
      endedUnmerged: inPeriod.filter((f) => f.doneAt !== undefined && !f.merged).length,
      fixes: inPeriod.map((f) => ({ id: f.id, machine: f.machine, created: f.created, cause: causeOf(f, all[all.indexOf(f) - 1]) })),
    });
  }
  return out.sort((a, b) => b.mostIn24h - a.mostIn24h || a.step.localeCompare(b.step));
}

/** The lines `measure --refiles` prints. */
export function refileLines(rows: StepRefiles[]): string[] {
  if (rows.length === 0) return ["no step had two fix tasks in one 24 hours"];
  return rows.flatMap((r) => [
    `${r.step}: most in 24 hours ${r.mostIn24h}, ${r.fixes.length} in the period, ${r.endedUnmerged} ended with no merge`,
    ...r.fixes.map((f) => `  ${f.id} ${new Date(f.created).toISOString()} ${f.machine}: ${f.cause}`),
  ]);
}
