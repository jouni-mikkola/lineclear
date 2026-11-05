import { readJson } from "../pi/config.ts";
import { dataDir, piDir } from "./paths.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readTasksKept, type TaskLine } from "./kept-read.ts";
import { join } from "node:path";
import { piHarness } from "./harness-pi.ts";
import { reviewerRound, type Usage } from "./session-text.ts";
import { addCall, type Band, emptyBands, mergeBands } from "./measure-bands.ts";
import { lockHeldAfterEnd, waitCauses, type StepDecision, type StepWait, type Window } from "./wait-causes.ts";

export { sessionFolder } from "./harness-pi.ts";

type Env = Record<string, string | undefined>;

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tiers?: (Partial<Price> & { inputTokensAbove: number })[];
}

export interface TaskInfo {
  id: string;
  title: string;
  facts?: string;
  /** When its agent started, in ms. Undefined for a task that never started (queued, no worktree). */
  start?: number;
  worktree: string;
  /** When it stopped running (done or closed), in ms. Undefined while it runs. */
  end?: number;
  /** When its agent first reported done (review passed), and when it was merged, in ms. Only a merged task has both. */
  ready?: number;
  merged?: number;
}

export interface Measured {
  /** Need cards, by time in ms. */
  asks: number[];
  /** Steps in roadmap order: id, `after` ids, and the time in ms of the commit that merged it, if any. */
  steps: { id: string; after: string[]; merged?: number }[];
  tasks: TaskInfo[];
  /** The usage of a task's session files, or undefined when none were found. */
  usageOf: (task: TaskInfo) => Usage[] | undefined;
  /** The times in ms of every model turn that no step and no owner message started (see `turnTimes`). */
  turns?: number[];
  priceOf: (usage: Usage) => Price | undefined;
  /** The token pack's parts that were on for a whole task (none when its sessions recorded none). */
  partsOf?: (task: TaskInfo) => string[];
  /** The rule loop's decision lines that name a step, for the causes of a wait. */
  decisions?: StepDecision[];
  /** The repo's part names, to tell a part held from a lock held. */
  partNames?: string[];
}

/** Cost per merged step for the steps with a token pack part on, and for those without it. */
export interface PartSplit {
  part: string;
  on: { perStep: number; tokens: number; steps: number } | null;
  off: { perStep: number; tokens: number; steps: number } | null;
}

interface Day {
  date: string;
  asks: number;
  wait: { median: number; tasks: number } | null;
  /** Median minutes from review passed to merged, for the tasks merged that day. */
  lane: { median: number; tasks: number; longest: number } | null;
  cost: { perStep: number; tokens: number; steps: number } | null;
  /** Model turns not started by a step or an owner message. The goal is 0. */
  turns: number;
}

export interface Numbers {
  days: Day[];
  /** Models with no price in pi's model data. */
  unpriced: string[];
  /** Tasks with no session file found. */
  noSession: string[];
  /** Merged steps in range that no task was found for. */
  noTask: string[];
  /** Cost per merged step split by token pack part: each part seen in a session record. */
  parts: PartSplit[];
  /** Cost per merged step split by cause (kind of token), over the steps counted in the day table; shares sum to 1. */
  causes: { cause: Cause; perStep: number; share: number }[];
  /** Cost per call by context band, over the steps counted in the day table. */
  bands: Band[];
  /** The tokens of each merged step in range whose sessions were all found, priced or not. */
  stepTokens: number[];
  /** Tokens and dollars the reviewers spent, per task that merged or started since the day. A call with no price adds tokens only. */
  reviews: ReviewCost[];
  /** For each step whose wait is counted: its minutes by cause. */
  waitCauses: StepWait[];
  /** Minutes of every counted wait, for a median over several days. */
  waitMinutes: number[];
  /** Median minutes a lock stayed held after its task ended, over the waits that named one. The goal is 0 within one tick. */
  lockAfterEnd: { median: number; locks: number } | null;
}

const tokensOf = (u: Usage) => u.input + u.output + u.cacheRead + u.cacheWrite;

/** What a task's reviewers cost: the calls of their sessions, in tokens and priced dollars. */
interface ReviewCost {
  task: string;
  rounds: number;
  tokens: number;
  dollars: number;
}

export const DAY = 86_400_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
}

/** The equivalent $ of one message. Prices are per million tokens. A tier applies when the prompt is above its size. */
export function costOf(u: Usage, p: Price): number {
  return Object.values(costByCause(u, p)).reduce((a, b) => a + b, 0);
}

/** The causes of a step's cost: the kinds of token it is paid for. */
const CAUSES = ["input", "output", "cacheRead", "cacheWrite"] as const;
type Cause = (typeof CAUSES)[number];
type CauseCosts = Record<Cause, number>;

/** The dollars of one message by kind of token; they sum to `costOf`. */
function costByCause(u: Usage, p: Price): CauseCosts {
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  let rate: Price = p;
  for (const t of p.tiers ?? []) {
    if (prompt > t.inputTokensAbove) rate = { ...p, ...t };
  }
  const dollars = (cause: Cause) => (u[cause] * rate[cause]) / 1e6;
  return { input: dollars("input"), output: dollars("output"), cacheRead: dollars("cacheRead"), cacheWrite: dollars("cacheWrite") };
}

/** The values of a day-keyed map, with one more under `day`. */
function push<T>(map: Map<string, T[]>, day: string, value: T): void {
  map.set(day, [...(map.get(day) ?? []), value]);
}

/** Wait: a step is ready at the last merge among its `after`; its first task starts the wait's end. */
function waitWindows(m: Measured, from: number, tasksOf: (id: string) => TaskInfo[]): Window[] {
  const mergedAt = new Map(m.steps.filter((s) => s.merged !== undefined).map((s) => [s.id, s.merged as number]));
  const windows: Window[] = [];
  for (const s of m.steps) {
    const real = s.after.filter((a) => a !== "none");
    if (real.length === 0 || !real.every((a) => mergedAt.has(a))) continue;
    const ready = Math.max(...real.map((a) => mergedAt.get(a) as number));
    const first = tasksOf(s.id)[0];
    if (first === undefined || (first.start as number) < ready || (first.start as number) < from) continue;
    windows.push({ step: s.id, ready, start: first.start as number });
  }
  return windows;
}

/** Minutes of each wait, by the day the task started. */
function waitsByDay(windows: Window[]): Map<string, number[]> {
  const waits = new Map<string, number[]>();
  for (const w of windows) push(waits, dayOf(w.start), (w.start - w.ready) / 60_000);
  return waits;
}

/** What one merged step's tasks cost: dollars and tokens of the priced usage, and all tokens. `whole` is false when a session or a price is missing. */
function stepCost(m: Measured, own: TaskInfo[], unpriced: Set<string>, noSession: Set<string>) {
  let total = 0;
  let tokens = 0;
  const causes: CauseCosts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const bands = emptyBands();
  let whole = true;
  let found = true;
  let all = 0;
  for (const t of own) {
    const usage = m.usageOf(t);
    if (usage === undefined) {
      noSession.add(t.id);
      whole = false;
      found = false;
      continue;
    }
    for (const u of usage) {
      const n = tokensOf(u);
      all += n;
      const price = m.priceOf(u);
      if (price === undefined) {
        unpriced.add(u.provider ? `${u.provider}/${u.model}` : u.model);
        whole = false;
      } else {
        const by = costByCause(u, price);
        for (const c of CAUSES) causes[c] += by[c];
        total += costOf(u, price);
        addCall(bands, u, costOf(u, price));
        tokens += n;
      }
    }
  }
  return { total, tokens, whole, found, all, causes, bands };
}

/** The token pack parts that were on for every task of a step. */
function commonParts(partsOf: (t: TaskInfo) => string[], own: TaskInfo[]): { common: Set<string>; every: Set<string>[] } {
  const sets = own.map((t) => new Set(partsOf(t)));
  return { common: sets.reduce((a, b) => a.intersection(b)), every: sets };
}

/** Lane: from a task's ready report (its review passed) to its merge, on the day it merged. Minutes. */
function lanesByDay(m: Measured, from: number): Map<string, number[]> {
  const lanes = new Map<string, number[]>();
  for (const t of m.tasks) {
    if (t.ready === undefined || t.merged === undefined || t.merged < from || t.merged < t.ready) continue;
    push(lanes, dayOf(t.merged), (t.merged - t.ready) / 60_000);
  }
  return lanes;
}

type Costed = { total: number; tokens: number };

const meanCost = (xs: Costed[]) => ({
  perStep: xs.reduce((a, b) => a + b.total, 0) / xs.length,
  tokens: xs.reduce((a, b) => a + b.tokens, 0) / xs.length,
  steps: xs.length,
});

/** Cost: a step counts on the day it merged, once every one of its tasks has a session file and a price. */
function costsByDay(
  m: Measured,
  from: number,
  tasksOf: (id: string) => TaskInfo[],
  missing: { unpriced: Set<string>; noSession: Set<string>; noTask: string[] },
) {
  const costs = new Map<string, Costed[]>();
  const costed: { total: number; tokens: number; on: Set<string> }[] = [];
  const stepTokens: number[] = [];
  const seen = new Set<string>();
  const causes: CauseCosts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const bands = emptyBands();
  let steps = 0;
  for (const s of m.steps) {
    if (s.merged === undefined || s.merged < from) continue;
    const own = tasksOf(s.id).filter((t) => (t.start as number) <= (s.merged as number));
    if (own.length === 0) {
      missing.noTask.push(s.id);
      continue;
    }
    const { total, tokens, whole, found, all, causes: by, bands: stepBands } = stepCost(m, own, missing.unpriced, missing.noSession);
    if (found) stepTokens.push(all);
    if (!whole) continue;
    steps++;
    for (const c of CAUSES) causes[c] += by[c];
    mergeBands(bands, stepBands);
    if (m.partsOf) {
      const { common, every } = commonParts(m.partsOf, own);
      costed.push({ total, tokens, on: common });
      for (const x of every) for (const name of x) seen.add(name);
    }
    push(costs, dayOf(s.merged), { total, tokens });
  }
  return { costs, costed, stepTokens, seen, causes, steps, bands };
}

function reviewCosts(m: Measured, from: number): ReviewCost[] {
  const out: ReviewCost[] = [];
  for (const t of m.tasks) {
    if ((t.merged ?? t.start ?? 0) < from) continue;
    const calls = (m.usageOf(t) ?? []).filter((u) => u.role === "reviewer");
    if (calls.length === 0) continue;
    let dollars = 0;
    for (const u of calls) {
      const price = m.priceOf(u);
      if (price) dollars += costOf(u, price);
    }
    out.push({
      task: t.id,
      rounds: Math.max(...calls.map((u) => u.round ?? 1)),
      tokens: calls.reduce((a, u) => a + tokensOf(u), 0),
      dollars,
    });
  }
  return out;
}

/** The three numbers for each day from `since` (a day, YYYY-MM-DD) to the last day with anything in it. */
export function measure(m: Measured, since: string): Numbers {
  const from = Date.parse(`${since}T00:00:00Z`);
  // only started tasks count, earliest first: a later task of a step (a fix, a polish) is not its wait or its cost
  const tasksOf = (id: string) =>
    m.tasks.filter((t) => t.start !== undefined && t.title.startsWith(`${id} `)).sort((a, b) => (a.start as number) - (b.start as number));
  const unpriced = new Set<string>();
  const noSession = new Set<string>();
  const noTask: string[] = [];

  const asks = new Map<string, number>();
  for (const at of m.asks) if (at >= from) asks.set(dayOf(at), (asks.get(dayOf(at)) ?? 0) + 1);
  const windows = waitWindows(m, from, tasksOf);
  const waits = waitsByDay(windows);

  const stepCosts = costsByDay(m, from, tasksOf, { unpriced, noSession, noTask });
  const { costs, costed, stepTokens, seen, causes, steps, bands } = stepCosts;
  const sum = Object.values(causes).reduce((a, b) => a + b, 0);
  const byCause = CAUSES.map((cause) => ({ cause, perStep: steps === 0 ? 0 : causes[cause] / steps, share: sum === 0 ? 0 : causes[cause] / sum }));
  const lanes = lanesByDay(m, from);
  const turns = new Map<string, number>();
  for (const at of m.turns ?? []) if (at >= from) turns.set(dayOf(at), (turns.get(dayOf(at)) ?? 0) + 1);

  const last = Math.max(from, ...[...turns.keys(), ...asks.keys(), ...waits.keys(), ...costs.keys(), ...lanes.keys()].map((d) => Date.parse(`${d}T00:00:00Z`)));
  const days: Day[] = [];
  for (let t = from; t <= last; t += DAY) {
    const date = dayOf(t);
    const w = waits.get(date);
    const c = costs.get(date);
    const l = lanes.get(date);
    days.push({
      date,
      asks: asks.get(date) ?? 0,
      turns: turns.get(date) ?? 0,
      wait: w ? { median: median(w), tasks: w.length } : null,
      lane: l ? { median: median(l), tasks: l.length, longest: Math.max(...l) } : null,
      cost: c ? meanCost(c) : null,
    });
  }
  const mean = (xs: typeof costed) => (xs.length === 0 ? null : meanCost(xs));
  const split = [...seen].sort().map((part) => ({
    part,
    on: mean(costed.filter((c) => c.on.has(part))),
    off: mean(costed.filter((c) => !c.on.has(part))),
  }));
  // the task that held the lock was the latest one of its step started before the skip line
  const ends = (step: string, at: number) =>
    tasksOf(step)
      .filter((t) => (t.start as number) <= at)
      .pop()?.end;
  const held = lockHeldAfterEnd(
    (m.decisions ?? []).filter((d) => d.at >= from),
    ends,
  );
  return {
    days,
    lockAfterEnd: held.length === 0 ? null : { median: median(held), locks: held.length },
    unpriced: [...unpriced].sort(),
    noSession: [...noSession].sort(),
    noTask: noTask.sort(),
    parts: split,
    causes: byCause,
    bands,
    stepTokens,
    reviews: reviewCosts(m, from),
    waitMinutes: windows.map((w) => (w.start - w.ready) / 60_000),
    waitCauses: waitCauses(windows, m.decisions ?? [], new Set(m.partNames ?? [])),
  };
}

// ---- reading the files ----

export function shepherdrDir(env: Env): string {
  return dataDir(env);
}

/** The space of a project: its entry in spaces.json, by name, key or folder. */
export function findSpace(dir: string, space: string, repo: string): { name: string; key: string } | undefined {
  const spaces: any[] = readJson(join(dir, "spaces.json")) ?? [];
  const s = spaces.find((x) => x.name === space || x.key === space || x.path === repo);
  return s ? { name: s.name, key: s.key } : undefined;
}

/** A space's tasks: tasks.json with its append log, and with `retired`, the ones in the archive; each once. */
export function spaceTasks(dir: string, space: { key: string }, retired = false): any[] {
  const raw: any[] = readTasksKept(dir).tasks;
  const live = Array.isArray(raw) ? raw : Object.values(raw);
  // a task retired twice (a stop between the two writes) or still in tasks.json counts once
  const byId = new Map([...(retired ? retiredTasks(dir) : []), ...live].map((t) => [String(t.id), t] as const));
  return [...byId.values()].filter((t) => String(t.id).startsWith(`${space.key}-`));
}

/** The chat logs of a space's tasks, with the ones of retired tasks in archive/chatlog. */
export function chatFiles(dir: string, space: { name: string; key: string }): any[] {
  const own = (f: string) => f.startsWith(`${space.key}-`) || (f.startsWith("p_") && f.endsWith(`_${space.name}.json`));
  return [join(dir, "chatlog"), join(dir, "archive", "chatlog")]
    .filter((log) => existsSync(log))
    .flatMap((log) =>
      readdirSync(log)
        .filter((f) => f.endsWith(".json") && own(f))
        .map((f) => readJson(join(log, f))),
    )
    .filter((d) => d !== undefined);
}

/** The records of retired tasks, from archive/tasks-<month>.jsonl. */
function retiredTasks(dir: string): TaskLine[] {
  const archive = join(dir, "archive");
  if (!existsSync(archive)) return [];
  return readdirSync(archive)
    .filter((f) => f.startsWith("tasks-") && f.endsWith(".jsonl"))
    .flatMap((f) => readFileSync(join(archive, f), "utf8").split("\n"))
    .flatMap((l) => {
      try {
        return l ? [JSON.parse(l)] : [];
      } catch {
        return [];
      }
    });
}

/** The start of a task is its first "started" card, else the time it was made if it has a worktree, else it never started. */
export function taskStart(task: any, files: any[]): number | undefined {
  let start: number | undefined;
  for (const f of files) {
    for (const p of f.posted ?? []) {
      if (p?.card?.task === task.id && p.card.status === "work" && String(p.card.id).startsWith("go:")) {
        start = Math.min(start ?? Infinity, p.at);
      }
    }
  }
  return start ?? (task.worktree ? task.created : undefined);
}

/** The usage of a working folder's pi sessions, or undefined when none were found. */
export function worktreeUsage(worktree: string, env: Env): Usage[] | undefined {
  const texts = piHarness.readSessions(worktree, env);
  if (texts.length === 0) return undefined;
  let count = 0;
  return texts.flatMap((t) => {
    const named = reviewerRound(t);
    if (named === undefined) return piHarness.usage(t);
    count++;
    const round = named || count;
    return piHarness.usage(t).map((u) => ({ ...u, role: "reviewer" as const, round }));
  });
}

/** What a working folder's sessions cost at the same prices the usage charts use; undefined when no session was found or a model has no price. */
export function worktreeCost(worktree: string, env: Env): number | undefined {
  const usage = worktreeUsage(worktree, env);
  if (!usage) return undefined;
  const priceOf = priceFinder(readJson(join(piDir(env), "models-store.json")));
  let total = 0;
  for (const u of usage) {
    const price = priceOf(u);
    if (!price) return undefined;
    total += costOf(u, price);
  }
  return total;
}

/** The price of the same model in pi's model data: the same provider first, then any provider. */
export function priceFinder(store: any): (u: Usage) => Price | undefined {
  const find = (provider: string | undefined, model: string): Price | undefined => {
    for (const [name, group] of Object.entries<any>(store ?? {})) {
      if (provider !== undefined && name !== provider) continue;
      const hit = (group?.models ?? []).find((x: any) => x.id === model && x.cost);
      if (hit) return hit.cost;
    }
    return undefined;
  };
  return (u) => find(u.provider, u.model) ?? find(undefined, u.model);
}
