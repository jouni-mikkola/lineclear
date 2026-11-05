import { isOpen, readItems } from "./inbox.ts";
import { chatFiles, findSpace, shepherdrDir, spaceTasks, taskStart, worktreeCost } from "./measure.ts";
import { readRuns } from "./check-runs.ts";
import { projectSettings, roadmapData, type RoadmapStep } from "./roadmap-view.ts";
import { allChecks } from "./step-check-cost.ts";
import { readWaits, type Wait } from "./waits.ts";

// What a step's own page shows besides its roadmap entry: its done-when checklist with the evidence for each item,
// what exactly holds it up, and its history. All of it from files and git, with no model.

type Env = Record<string, string | undefined>;

/** A reason a step is held, linked to the step, slot, quota or Inbox ask it waits for. */
interface StepWait {
  kind: "step" | "lock" | "slot" | "quota" | "you";
  text: string;
  /** Where the link goes: a step's page, Home, Usage or an Inbox ask. */
  href: string;
}

interface CheckRun {
  at: number;
  tier: string;
  ok: boolean;
  seconds: number;
  failed: string[];
}

export interface StepRecord {
  step: string;
  /** The done-when items. `evidence` says what ticks one; an item with none stays open. */
  checklist: { text: string; evidence?: string }[];
  waits: StepWait[];
  /** Each answer of the fresh model that read the step cold, oldest first; no model is asked here. */
  read: { model: string; go: boolean; said: string; missing: string }[];
  /** Absent while no task exists. A field a source does not report is absent too, and the page says "not reported". */
  history?: {
    task: string;
    branch?: string;
    pr?: { number: number; url: string };
    /** The review line of the task's ready facts. */
    review?: { round?: number; findings: string }[];
    checks: CheckRun[];
    /** Milliseconds from the step being ready to its task starting. */
    readyToStart?: number;
    /** Milliseconds from the task starting to its merge. */
    startToMerge?: number;
    /** Dollars, at the prices Usage uses. */
    cost?: number;
  };
}

/** The done-when items: each `- ` line at the outermost indent, with the lines under it. The roadmap read strips the
 *  first line's indent, so the indent of the lines after it is the list's. */
export function checklistItems(doneWhen: string): string[] {
  const lines = doneWhen.split("\n").filter((l) => l.trim() !== "");
  const indent = Math.min(...(lines.length > 1 ? lines.slice(1) : lines).map((l) => /^\s*/.exec(l)?.[0].length ?? 0));
  const items: string[] = [];
  for (const line of lines) {
    const top = line === lines[0] || ((/^\s*/.exec(line)?.[0].length ?? 0) === indent && line.trimStart().startsWith("- "));
    if (top || items.length === 0) items.push(line.trim().replace(/^- /, ""));
    else items[items.length - 1] += ` ${line.trim()}`;
  }
  return items;
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Whether the ready facts name an item: four words of it in a row, or `done when <n>` for its place in the list. */
export function namedBy(item: string, place: number, facts: string): boolean {
  const own = words(item);
  const said = ` ${words(facts).join(" ")} `;
  if (new RegExp(` done when ${place} `).test(said)) return true;
  for (let i = 0; i + 4 <= own.length; i++) if (said.includes(` ${own.slice(i, i + 4).join(" ")} `)) return true;
  return false;
}

function waitsOf(project: string, s: RoadmapStep, steps: RoadmapStep[], wait: Wait | undefined, askNumber: number | undefined): StepWait[] {
  const byId = new Map(steps.map((x) => [x.id, x]));
  const page = (id: string) => `/${project}/roadmap/${encodeURIComponent(id)}`;
  const named = (x: RoadmapStep) => `${x.id} ${x.title}`;
  const out: StepWait[] = [];
  for (const id of s.after) {
    const x = byId.get(id);
    if (x && x.state !== "done" && x.state !== "dropped") out.push({ kind: "step", text: `waits for ${named(x)}`, href: page(id) });
  }
  if (s.state !== "work") {
    for (const lock of s.locks) {
      const holder = steps.find((x) => x.id !== s.id && x.state === "work" && x.locks.includes(lock));
      if (holder) out.push({ kind: "lock", text: `uses the same part as ${named(holder)}, which is at work`, href: page(holder.id) });
    }
  }
  if (wait?.kind === "task") {
    const x = steps.find((o) => o.task?.id === wait.for);
    out.push({ kind: "step", text: x ? `waits for ${named(x)}` : `waits for ${wait.for ?? "another task"}`, href: x ? page(x.id) : "/" });
  } else if (wait?.kind === "checks") out.push({ kind: "slot", text: "waits for a free place to run the check", href: "/" });
  else if (wait?.kind === "until") out.push({ kind: "quota", text: `waits for the account limit to reset: ${wait.reason}`, href: "/usage" });
  if (wait?.kind === "owner" || wait?.kind === "login" || wait?.kind === "browser" || (!wait && s.task?.status === "need")) {
    out.push({ kind: "you", text: wait?.reason || s.task?.sub || "waits for you", href: askNumber === undefined ? "/inbox" : `/inbox/${askNumber}` });
  }
  return out;
}

type Task = NonNullable<ReturnType<typeof spaceTasks>[number]>;

/** A task's branch, pull request, review, check runs, times and cost, each only where a source reports it. */
function historyOf(
  task: Task,
  s: RoadmapStep,
  steps: RoadmapStep[],
  repo: string,
  chats: ReturnType<typeof chatFiles> | undefined,
  env: Env,
): NonNullable<StepRecord["history"]> {
  const started = chats ? taskStart(task, chats) : undefined;
  const readyAt = s.after.length
    ? Math.max(...s.after.map((a) => Math.min(...(steps.find((x) => x.id === a)?.commits.map((c) => c.at) ?? [Infinity]))))
    : undefined;
  const review = /(?:^|·)\s*review:\s*([^·]+)/.exec(String(task.facts ?? ""))?.[1]?.trim();
  const rounds = review ? [...review.matchAll(/round (\d+)\s*[:-]?\s*([^;]+)/gi)].map((m) => ({ round: Number(m[1]), findings: String(m[2]).trim() })) : [];
  const cost = typeof task.worktree === "string" ? worktreeCost(task.worktree, env) : undefined;
  return {
    task: String(task.id),
    ...(task.branch ? { branch: String(task.branch) } : {}),
    ...(task.pr?.url ? { pr: { number: Number(task.pr.number), url: String(task.pr.url) } } : {}),
    ...(review ? { review: rounds.length ? rounds : [{ findings: review }] } : {}),
    checks: task.branch
      ? readRuns(repo, 0, env)
          .filter((r) => r.branch === task.branch)
          .map((r) => ({ at: r.at, tier: r.tier, ok: r.ok, seconds: r.seconds, failed: r.failed }))
      : [],
    ...(started !== undefined && readyAt !== undefined && Number.isFinite(readyAt) && started >= readyAt ? { readyToStart: started - readyAt } : {}),
    ...(started !== undefined && task.merged === true && typeof task.doneAt === "number" ? { startToMerge: task.doneAt - started } : {}),
    ...(cost !== undefined ? { cost } : {}),
  };
}

/** The page data of one step, or the reason there is none. */
export function stepRecord(
  project: string,
  id: string,
  env: Env = process.env,
  tasksOf?: Parameters<typeof roadmapData>[2],
): StepRecord | { error: string; status: number } {
  const read = roadmapData(project, env, tasksOf);
  if (!("ok" in read)) return { error: read.error, status: read.status };
  const settings = projectSettings(project, env);
  const s = read.ok.steps.find((x) => x.id === id);
  if (!s || !settings) return { error: `${project} has no step ${id}.`, status: 404 };
  const dir = shepherdrDir(env);
  const space = findSpace(dir, settings.space, settings.repo);
  const tasks = space ? spaceTasks(dir, space, true).filter((t) => String(t.title ?? "").startsWith(`${id} `)) : [];
  // the merged task is the step's; else the open one, else the latest
  const task = tasks.find((t) => t.merged === true) ?? tasks.find((t) => !t.doneAt) ?? tasks.sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0];
  const items = checklistItems(s.doneWhen);
  const facts = [task?.facts, task?.said].filter((x): x is string => typeof x === "string").join(" ");
  const merge = s.state === "done" ? s.commits.at(-1) : undefined;
  const checklist = items.map((text, i) => {
    if (merge) return { text, evidence: `merge commit ${merge.commit.slice(0, 7)}` };
    if (s.state === "work" && facts && namedBy(text, i + 1, facts)) return { text, evidence: `named in the facts of its task` };
    return { text };
  });
  const wait = task ? readWaits(env).find((w) => w.task === task.id) : undefined;
  const ask = task ? readItems(env).find((i) => isOpen(i) && i.task === task.id) : undefined;
  const waits = s.state === "done" || s.state === "dropped" ? [] : waitsOf(project, s, read.ok.steps, wait, ask?.n);
  const cold = allChecks(env as NodeJS.ProcessEnv)
    .filter((a) => a.step === id)
    .map(({ model, go, said, missing }) => ({ model, go, said, missing }));
  if (!task) return { step: id, checklist, waits, read: cold };

  return { step: id, checklist, waits, read: cold, history: historyOf(task, s, read.ok.steps, settings.repo, space ? chatFiles(dir, space) : undefined, env) };
}
