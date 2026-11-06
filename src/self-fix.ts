import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { planBrief } from "./plan-brief.ts";
import { listProjectNames, readSettings, type Settings } from "./project.ts";
import { addItem, isOpen as itemOpen, readItems } from "./inbox.ts";
import type { Decision, World } from "./rules.ts";
import { CLASS_INFO, readDecisionsSince, type StallClass } from "./stall-class.ts";
import { configDir, readJson } from "../pi/config.ts";
import type { Task } from "./roadmap.ts";
import { DAY } from "./time.ts";

// Lineclear files its own bugs through `fileFix`: an unknown stall, or a known one seen twice in 24 hours, a waste past
// its limit, and a step that is reopened, unproven or closed with a failing test. A hard cap: at most one open per fix
// and at most DAY_CAP filed in any 24 hours in all, so it cannot fill its own roadmap or spend its tokens on itself.
// A fix task that ends with nothing merged goes to the Inbox, so nothing is skipped in silence.

const TITLE_MAX = 32;
const EVIDENCE_MAX = 8;
export const DAY_CAP = 3;

interface Fix {
  title: string;
  project: string;
  /** When it was filed. */
  since: string;
  evidence: string[];
  /** When its task was seen ended or gone: stalls before this do not file it again. */
  closed?: string;
  /** When this fix was filed in the last 24 hours, for the day cap. */
  filed?: string[];
  /** The space whose task list holds the fix task, and whether it is a planning task (which may end with no merge). */
  space?: string;
  planning?: boolean;
  /** What the fix was filed for (a proof record's head): the same cause is not filed twice. */
  basis?: string;
  /** The Inbox item that told the owner this fix task ended without a merge. */
  told?: number;
}

/** Every fix filed, by key: a stall class, `waste:<id>`, or `<project>:<step>:<kind>`. */
export type Fixes = Record<string, Fix>;

/** Fixes filed in the 24 hours before `now`, all classes together. */
function filedToday(fixes: Fixes, now: Date): number {
  const from = new Date(now.getTime() - DAY).toISOString();
  return Object.values(fixes).reduce((n, f) => n + (f ? (f.filed ?? [f.since]) : []).filter((t) => t > from).length, 0);
}

const capReason = () => `${DAY_CAP} fixes were filed in the last 24 hours, the most a day`;

const fixesPath = (env = process.env) => join(configDir(env), "fixes.json");
const writeFixes = (fixes: Fixes, env = process.env) => writeAtomic(fixesPath(env), `${JSON.stringify(fixes, null, 2)}\n`);

export function readFixes(env = process.env): Fixes {
  try {
    return JSON.parse(readFileSync(fixesPath(env), "utf8"));
  } catch {
    return {};
  }
}

/** Lineclear's own project: the one whose settings say `self`, else the one whose repo is the lineclear package. */
export function selfProject(env = process.env): { name: string; settings: Settings } | undefined {
  const all = listProjectNames(env)
    .map((name) => ({ name, settings: readSettings(name, env) }))
    .filter((p): p is { name: string; settings: Settings } => typeof p.settings !== "string");
  const marked = all.find((p) => p.settings.self === true);
  if (marked) return marked;
  return all.find((p) => {
    try {
      return JSON.parse(readFileSync(join(p.settings.repo, "package.json"), "utf8")).name === "lineclear";
    } catch {
      return false;
    }
  });
}

const fixTitle = (c: StallClass) => `Plan: fix ${CLASS_INFO[c].label}`.slice(0, TITLE_MAX);

/** The planner's goal: the title, the result it must reach and the evidence. */
function fixGoal(c: StallClass, evidence: string[]): string {
  const info = CLASS_INFO[c];
  return [
    `Fix the stall class '${c}' (${info.label}) in Lineclear itself.`,
    c === "unknown"
      ? "Result: the stall below gets a named class with a detector in src/stall-class.ts and a remedy in the stall ladder, and the cause is fixed, so it does not come back."
      : `Result: the cause is fixed, so this class does not come back within a day; its remedy today (${info.remedy}) is not enough.`,
    "Add one step to docs/ROADMAP.md with that result as its done when, and a test that plants the stall.",
    "Evidence (from decisions.jsonl):",
    ...evidence.map((e) => `- ${e}`),
  ].join("\n");
}

const isStall = (d: Decision) => d.event === "stall" || (d.event === "remedy" && d.kind === "stall" && typeof d.minutes === "number");

const isOpen = (f: { title: string }, tasks: { title: string; status: string }[]) =>
  tasks.some((t) => t.title === f.title && t.status !== "done" && t.status !== "closed");

/** A task that ended with nothing merged: closed, or done with nothing to merge (a planning task may end that way). */
const endedUnmerged = (t: { status: string; closed?: boolean }, planning: boolean) =>
  t.status === "closed" || (!planning && t.status === "done" && t.closed === true);

/**
 * Marks closed each open fix whose task is gone or ended. One that ended without a merge also puts an item in the
 * Inbox, so the step it was filed for is not skipped in silence. True when one changed.
 */
function settleFixes(world: World, fixes: Fixes, env = process.env): boolean {
  let changed = false;
  for (const f of Object.values(fixes)) {
    // a stall fix filed before the ledger kept its space is a planning task of Lineclear's own project
    const space = f.space ?? selfProject(env)?.settings.space;
    if (f.closed !== undefined || space === undefined) continue;
    const tasks = world.tasks(space);
    if (typeof tasks === "string" || isOpen(f, tasks)) continue;
    f.closed = world.now().toISOString();
    changed = true;
    const task = tasks.find((t) => t.title === f.title);
    if (!task || !endedUnmerged(task, f.planning ?? f.space === undefined)) continue;
    const lines = f.evidence.slice(0, 3).map((e) => `- ${e}`);
    f.told = addItem(
      {
        kind: "step",
        task: "-",
        project: f.project,
        question: [`The fix task "${f.title}" ended without a merge. It was filed for:`, ...lines].join("\n"),
        choices: ["Ok"],
        alert: `${f.title} ended without a merge`,
        since: f.closed,
      },
      env,
    ).n;
  }
  return changed;
}

/** The stalls of the last day by class; a class whose fix closed counts only the stalls after that. */
function stallsByClass(decisionsFile: string, fixes: Fixes, now: Date): Map<StallClass, Decision[]> {
  const byClass = new Map<StallClass, Decision[]>();
  for (const d of readDecisionsSince(decisionsFile, now.getTime() - DAY).filter(isStall)) {
    const c = d.class as StallClass;
    if (!(c in CLASS_INFO)) continue;
    const after = fixes[c]?.closed;
    if (after !== undefined && d.time < after) continue;
    byClass.set(c, [...(byClass.get(c) ?? []), d]);
  }
  return byClass;
}

/**
 * Files a fix for each class that needs one and has none open. Reads the last day of decisions; a class whose fix
 * closed counts only the stalls after that. Returns the decisions it made.
 */
export function fileFixes(world: World, decisionsFile: string, fresh: Decision[], env = process.env): Decision[] {
  const now = world.now();
  const fixes = readFixes(env);
  const anyOpen = Object.values(fixes).some((f) => f.closed === undefined);
  // nothing new and nothing open to look at: no file read
  if (!fresh.some(isStall) && !anyOpen) return [];
  const self = selfProject(env);
  const out: Decision[] = [];
  const note = (kind: Decision["kind"], reason: string, c: StallClass) =>
    out.push({ time: now.toISOString(), project: self?.name ?? "-", kind, class: c, reason });
  if (settleFixes(world, fixes, env)) writeFixes(fixes, env);
  const byClass = stallsByClass(decisionsFile, fixes, now);
  for (const [c, ds] of byClass) {
    const f = fixes[c];
    if (f !== undefined && f.closed === undefined) continue;
    // only a stall of this tick can make a class cross its count, so nothing is filed or said twice
    if (!fresh.some((d) => isStall(d) && d.class === c)) continue;
    if (ds.length < (c === "unknown" || c === "fix-loop" ? 1 : 2)) continue;
    if (!self) {
      note("skip", `a fix for the stall class '${c}' waits: no project is Lineclear's own (set "self": true in its settings)`, c);
      continue;
    }
    const evidence = ds.slice(-EVIDENCE_MAX).map((d) => `${d.time} ${d.project} ${d.step ?? "-"}: ${d.reason}`);
    const r = fileFix(world, classFix(c, self, evidence), env);
    if (!r.filed) {
      note("skip", `a fix for the stall class '${c}' waits: ${r.why}`, c);
      continue;
    }
    note("start", `filed a fix for the stall class '${c}' (${ds.length} in 24 h): ${fixTitle(c)}`, c);
  }
  return out;
}

type Project = { name: string; settings: Settings };

/** A fix to file: one task on `project`'s space, and the ledger entry `key` that remembers it. */
export interface FixSpec {
  key: string;
  /** For a step's fix it starts with the step id. */
  title: string;
  project: Project;
  brief: string;
  evidence: string[];
  /** What the fix is for, when it can change: a fix that ended is not filed again for the same basis. */
  basis?: string;
  /** A planning task of Lineclear's own project: the planner's model, no review, a merge only after asking. */
  planning?: boolean;
}

const classFix = (c: StallClass, self: Project, evidence: string[]): FixSpec => ({
  key: c,
  title: fixTitle(c),
  project: self,
  brief: planBrief(self.name, fixGoal(c, evidence)),
  evidence,
  planning: true,
});

function planningFlags(settings: Settings): string[] {
  const planner = settings.models.planner[0];
  return ["--agent", "pi", ...(planner ? ["--model", planner] : []), "--set", "review=off", "--set", "merge=ask me first"];
}

const endsPath = (env = process.env) => join(configDir(env), "fix-ends.json");
const outcomesPath = (env = process.env) => join(configDir(env), "fix-outcomes.json");
const OUTCOMES_KEPT = 10;

/** How a step's fix task ended: nothing merged, or merged. Oldest first in `Outcomes`, by when it was first seen ended. */
interface Outcome {
  task: string;
  title: string;
  unmerged: boolean;
  at: number;
}
type Outcomes = Record<string, Outcome[]>;

/** The step a fix spec is for: its key is `<project>:<step>:<kind>` and its title starts with the step id. */
function stepOfSpec(spec: FixSpec): string | undefined {
  const id = spec.title.split(" ")[0];
  return id && spec.key.startsWith(`${spec.project.name}:${id}:`) ? id : undefined;
}

/**
 * The step's fix tasks on every machine that are open or ended in the last 24 hours, or a reason it cannot tell.
 * A local task is the step's by the rules' record, another machine's by its title, `Fix <id> <title>` or `<id> Fix: <title>`.
 * A task has no end time in the list, so it ends when it was first seen not open.
 */
function stepFixHeld(world: World, spec: FixSpec, step: string, local: Task[], env: NodeJS.ProcessEnv): { open?: string; recent?: string } {
  const { settings, name } = { settings: spec.project.settings, name: spec.project.name };
  const recorded = (readJson(join(configDir(env), "projects", name, "state.json")) as { taskSteps?: Record<string, string> } | undefined)?.taskSteps ?? {};
  const titled = (t: Task) => t.title.startsWith(`${step} Fix`) || t.title.startsWith(`Fix ${step} `);
  const remote = (settings.machines ?? []).flatMap((host) => {
    const r = world.room?.(host, settings.space);
    return r === undefined || typeof r === "string" ? [] : r.tasks;
  });
  const mine = [...local.filter((t) => titled(t) || (t.id !== undefined && recorded[t.id] === step && t.title.includes("Fix"))), ...remote.filter(titled)];
  const now = world.now().getTime();
  const ends = (readJson(endsPath(env)) as Record<string, number> | undefined) ?? {};
  const held: { open?: string; recent?: string } = {};
  const outcomes = (readJson(outcomesPath(env)) as Outcomes | undefined) ?? {};
  const seenEnds = (outcomes[`${settings.space}:${step}`] ??= []);
  let outcomesChanged = false;
  let changed = false;
  for (const t of mine) {
    const key = `${settings.space}:${t.id ?? t.title}`;
    if (t.status !== "done" && t.status !== "closed") {
      held.open ??= `a fix task of ${step} is open: ${t.title}`;
      if (key in ends) delete ends[key], (changed = true);
      continue;
    }
    if (!(key in ends)) (ends[key] = now), (changed = true);
    if (!seenEnds.some((o) => o.task === key)) {
      seenEnds.push({ task: key, title: t.title, unmerged: endedUnmerged(t, false), at: ends[key] ?? now });
      seenEnds.sort((a, b) => a.at - b.at);
      seenEnds.splice(0, seenEnds.length - OUTCOMES_KEPT);
      outcomesChanged = true;
    }
    if (now - (ends[key] ?? 0) < DAY) held.recent ??= `a fix task of ${step} ended in the last 24 hours: ${t.title}`;
  }
  if (outcomesChanged) writeAtomic(outcomesPath(env), `${JSON.stringify(outcomes, null, 2)}\n`);
  const kept = Object.fromEntries(Object.entries(ends).filter(([, at]) => now - at < 2 * DAY));
  if (changed || Object.keys(kept).length !== Object.keys(ends).length) writeAtomic(endsPath(env), `${JSON.stringify(kept)}\n`);
  return held;
}

/** The step's last two fix tasks, when both ended with no merge and no fix of it merged between them: the loop's reason. */
function fixLoopReason(step: string, space: string, env: NodeJS.ProcessEnv): string | undefined {
  const last = ((readJson(outcomesPath(env)) as Outcomes | undefined)?.[`${space}:${step}`] ?? []).slice(-2);
  const [a, b] = last;
  if (!a || !b || !a.unmerged || !b.unmerged) return undefined;
  return `fix loop: the fix tasks of ${step} "${a.title}" and "${b.title}" both ended without a merge, so no third is filed`;
}

/**
 * The one way to file a fix task. Not while the fix's task is open (the title is looked up in the task list), not
 * while the Inbox item for its last unmerged end waits, and not over DAY_CAP fixes in 24 hours, all kinds together.
 */
export function fileFix(world: World, spec: FixSpec, env = process.env): { filed: true } | { filed: false; why: string } {
  const fixes = readFixes(env);
  if (settleFixes(world, fixes, env)) writeFixes(fixes, env);
  const { settings } = spec.project;
  const tasks = world.tasks(settings.space);
  if (typeof tasks === "string") return { filed: false, why: tasks };
  if (isOpen(spec, tasks)) return { filed: false, why: `a fix is already open: ${spec.title}` };
  const step = stepOfSpec(spec);
  const held = step === undefined ? {} : stepFixHeld(world, spec, step, tasks, env);
  if (held.open) return { filed: false, why: held.open };
  const loop = step === undefined ? undefined : fixLoopReason(step, settings.space, env);
  if (loop) return { filed: false, why: loop };
  if (held.recent) return { filed: false, why: held.recent };
  const prev = fixes[spec.key];
  if (spec.basis !== undefined && prev?.basis === spec.basis && prev.closed !== undefined)
    return { filed: false, why: "its last fix task ended and the cause is the same" };
  const told = prev?.told;
  if (told !== undefined && readItems(env).some((i) => i.n === told && itemOpen(i)))
    return { filed: false, why: `its last fix task ended without a merge: Inbox item ${told} waits` };
  if (filedToday(fixes, world.now()) >= DAY_CAP) return { filed: false, why: capReason() };
  const err = world.addTask(settings.space, spec.title, spec.brief, spec.planning ? planningFlags(settings) : []);
  if (err) return { filed: false, why: `could not file it: ${err}` };
  const now = world.now();
  const from = new Date(now.getTime() - DAY).toISOString();
  const filed = [...(prev?.filed ?? (prev ? [prev.since] : [])).filter((t) => t > from), now.toISOString()];
  fixes[spec.key] = {
    title: spec.title,
    project: spec.project.name,
    since: now.toISOString(),
    evidence: spec.evidence,
    filed,
    space: settings.space,
    planning: spec.planning,
    basis: spec.basis,
  };
  writeFixes(fixes, env);
  return { filed: true };
}

/** Files one fix for a class at once, as a broken test track run does: its one run is evidence enough. */
export function fileFixNow(world: World, c: StallClass, evidence: string[], env = process.env): string {
  const self = selfProject(env);
  if (!self) return `no fix filed: no project is Lineclear's own (set "self": true in its settings)`;
  const r = fileFix(world, classFix(c, self, evidence.slice(-EVIDENCE_MAX)), env);
  return r.filed ? `filed a fix: ${fixTitle(c)}` : r.why;
}
