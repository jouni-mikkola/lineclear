import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readItems, type Item } from "./inbox.ts";
import { listProjectNames, readSettings } from "./project.ts";
import { nearest } from "./resolve.ts";
import { roadmapData } from "./roadmap-view.ts";
import { tables } from "./tables.ts";

// A request is one goal handed to the Dispatcher with `lineclear plan`. It is kept by its plan id (PLAN-n), so the steps
// that plan adds can be followed: on the roadmap view at its live link, and with `lineclear status --plan <task>`.

export interface PlanRequest {
  task: string;
  project: string;
  goal: string;
  since: string;
  /** Who asked: the Dispatcher's chat, or someone on the command line. */
  by: "dispatcher" | "cli";
}

/** Where a request stands. */
type PlanState = "planning" | "approve" | "approved" | "rejected" | "closed";

export interface PlanView extends PlanRequest {
  state: PlanState;
  /** The steps the plan adds, by id, from its diff. None until the Dispatcher sends it. */
  steps: string[];
  /** The plan's Inbox item, the latest when it was sent back once. */
  item?: Item;
  /** The roadmap view of these steps. */
  live: string;
}

type Env = Record<string, string | undefined>;

/** The roadmap view of one request's steps, as a link on Lineclear's own pages. */
export const liveLink = (project: string, task: string) => `/${project}/roadmap/track?plan=${encodeURIComponent(task)}`;

export function recordRequest(r: PlanRequest, env: Env = process.env): void {
  tables(env).query("insert or replace into requests (task, since, request) values (?, ?, ?)").run(r.task, r.since, JSON.stringify(r));
}

/** Every request, oldest first. */
export function readRequests(env: Env = process.env): PlanRequest[] {
  const rows = tables(env).query("select request from requests order by since").all() as { request: string }[];
  return rows.map((r) => JSON.parse(r.request) as PlanRequest);
}

/** The ids of the steps a roadmap diff adds. */
export function addedSteps(diff: string) {
  const gone = new Set([...diff.matchAll(/^-### (\S+)/gm)].map((m) => m[1]!));
  return [...diff.matchAll(/^\+### (\S+)/gm)].map((m) => m[1]!).filter((id) => !gone.has(id));
}

/** Where one request stands, from its plan's Inbox items. */
function planView(r: PlanRequest, items: Item[] = readItems(process.env)): PlanView {
  const item = items
    .filter((i) => i.auto && i.task === r.task && !i.move)
    .sort((a, b) => a.n - b.n)
    .at(-1);
  let state: PlanState = "planning";
  if (item) state = "approved";
  return { ...r, state, steps: item?.diff ? addedSteps(item.diff) : [], ...(item ? { item } : {}), live: liveLink(r.project, r.task) };
}

/** Every request with where it stands, newest first. */
export const planViews = (env: Env = process.env) => {
  const items = readItems(env as NodeJS.ProcessEnv);
  return readRequests(env)
    .map((r) => planView(r, items))
    .reverse();
};

const SAID: Record<PlanState, string> = {
  planning: "the Dispatcher writes the steps",
  approve: "the steps wait for your approval",
  approved: "approved, the steps are in the roadmap",
  rejected: "rejected",
  closed: "closed",
};

const WORD = { done: "merged", dropped: "dropped", work: "at work", ready: "ready to start", waiting: "waits", unproven: "merged, unproven" } as const;

/** The lines of an approved plan's steps, each as the roadmap stands on main. */
function stepLines(v: { project: string; steps: string[] }, env: Env, out: (l: string) => void): void {
  const read = roadmapData(v.project, env);
  if (!("ok" in read)) {
    out(`  ${read.error}`);
    return;
  }
  for (const id of v.steps) {
    const s = read.ok.steps.find((x) => x.id === id);
    if (!s) {
      out(`  ${id}  not in the roadmap on main yet`);
      continue;
    }
    const open = s.after.filter((a) => !["done", "dropped"].includes(read.ok.steps.find((x) => x.id === a)?.state ?? "done"));
    const word = s.state === "waiting" && open.length ? `waits for ${open.join(", ")}` : WORD[s.state];
    out(`  ${s.id} ${s.title}  ${word}${s.task?.id && s.state === "work" ? ` (${s.task.id}${s.task.sub ? `: ${s.task.sub}` : ""})` : ""}`);
    if (s.result) out(`      ${s.result}`);
  }
}

/**
 * `lineclear status --plan [<task>]`: where the steps of one request stand, or of the latest five. Each step's state
 * comes from the roadmap and the tasks, as on the roadmap view.
 */
export function planStatus(out: (l: string) => void, env: Env = process.env, task?: string): number {
  const views = planViews(env);
  const wanted = task === undefined ? undefined : (views.find((v) => v.task.toLowerCase() === task.trim().toLowerCase())?.task ?? task);
  if (task !== undefined && wanted !== task) out(`status of plan ${wanted} (read '${task}' as ${wanted})`);
  const shown = wanted === undefined ? views.slice(0, 5) : views.filter((v) => v.task === wanted);
  if (task !== undefined && shown.length === 0) {
    const near = nearest(
      task,
      views.map((v) => v.task),
    );
    return (out(`lineclear status: no plan from task '${task}'${near.length > 0 ? `, nearest: ${near.map((n) => `'${n}'`).join(" and ")}` : ""}`), 1);
  }
  if (shown.length === 0) out('no plans yet, start one with lineclear plan <project> "<goal>"');
  for (const v of shown) {
    const item = v.state === "approve" && v.item ? ` (Inbox ${v.item.n})` : "";
    out(`${v.task}  ${v.project}  "${v.goal}": ${SAID[v.state]}${item}. Live: ${v.live}`);
    if (v.state === "planning" && v.item?.note) out(`  the owner sent it back: ${v.item.note}`);
    if (v.steps.length === 0) continue;
    if (v.state !== "approved") {
      out(`  steps: ${v.steps.join(", ")}`);
      continue;
    }
    stepLines(v, env, out);
  }
  return 0;
}

const HEAD_LINES = 3;
const LINE_MAX = 200;

/** The first lines of a project's idea or README that say what it is: no headings, pictures, badges or HTML. */
export function about(repo: string): string[] {
  for (const f of ["docs/idea.md", "README.md"]) {
    const file = join(repo, f);
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8")
      .split("\n")
      .map((l) => l.trim().replace(/\*\*/g, ""))
      .filter((l) => l !== "" && !/^(#|<|!\[|\[!\[|```|---|\|)/.test(l));
    if (lines.length) return lines.slice(0, HEAD_LINES).map((l) => (l.length > LINE_MAX ? `${l.slice(0, LINE_MAX - 3)}...` : l));
  }
  return [];
}

/**
 * `lineclear dispatcher projects`: what the Dispatcher picks a project from. Plain code gives each project's name,
 * repo and the first lines of its idea or README; the Dispatcher's model picks.
 */
export function projectsMain(out: (l: string) => void, env: Env = process.env): number {
  const names = listProjectNames(env as NodeJS.ProcessEnv);
  if (names.length === 0) return (out("no projects, add one with 'lineclear project add <repo>'"), 0);
  for (const name of names) {
    const s = readSettings(name, env as NodeJS.ProcessEnv);
    if (typeof s === "string") continue;
    out(`${name}  ${s.repo}`);
    for (const l of about(s.repo)) out(`  ${l}`);
  }
  return 0;
}
