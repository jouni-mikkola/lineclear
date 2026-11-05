import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { configDir } from "../pi/config.ts";
import type { StepCheck } from "./stepcheck.ts";

// What the step check costs and what it saves, per merged step, split by whether the step was planned with the check.
// Counts only: no model reads anything here.

/** The numbers of a group of merged steps. */
interface CheckGroup {
  steps: number;
  noGos: number;
  /** Review rounds that found a critical or major finding. */
  reviewRounds: number;
  /** Merge-tier check runs that failed on a step's branch. */
  refusedMerges: number;
  reverts: number;
  questions: number;
  /** What the checking model read and wrote, and its price when pi's model data has one. */
  tokens: number;
  dollars: number;
}

export interface StepCheckNumbers {
  before: CheckGroup;
  withCheck: CheckGroup;
  /** Checking models with no price: their tokens count, their dollars do not. */
  unpriced: string[];
}

export interface StepCheckInput {
  /** The steps merged since the day asked, with the id each task of the step starts its title with. */
  steps: string[];
  tasks: { id: string; title: string; facts?: string; worktree: string }[];
  checks: StepCheck[];
  /** The task of each owner question. */
  askTasks: (string | undefined)[];
  /** Failed merge-tier runs: the branch they ran on. */
  failedMerges: string[];
  /** The subjects of the commits on main that start with Revert. */
  reverts: string[];
  /** The price of a call in dollars, undefined when pi's model data has none for the model. */
  dollarsOf: (model: string, tokensIn: number, tokensOut: number) => number | undefined;
}

/** The part of a step check answer (`plan-checks/<task>.json`, see `src/stepcheck.ts`) that is counted. */

/** Every answer of every planning task. */
export function allChecks(env: NodeJS.ProcessEnv = process.env): StepCheck[] {
  const dir = join(configDir(env), "plan-checks");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => (JSON.parse(readFileSync(join(dir, f), "utf8")).answers ?? []) as StepCheck[]);
}

const empty = (): CheckGroup => ({ steps: 0, noGos: 0, reviewRounds: 0, refusedMerges: 0, reverts: 0, questions: 0, tokens: 0, dollars: 0 });

/** A task's branch from its worktree folder: `work-41-x` is `work/41-x`. */
const branchOf = (worktree: string): string => basename(worktree).replace(/^work-/, "work/");

/** The rounds named in a ready report ("round 1: 2 major; round 2: none") that had a critical or major finding. */
function findingRounds(facts: string | undefined): number {
  return (facts ?? "")
    .split(/\bround\s*\d+/i)
    .slice(1)
    .filter((part) => /\b[1-9]\d*\s+(?:critical|major)\b/i.test(part)).length;
}

/** Rounds a ready report names: the highest round number in it, 0 when it names none. */
export function roundsNamed(facts: string | undefined): number {
  return Math.max(0, ...[...(facts ?? "").matchAll(/\bround\s*(\d+)/gi)].map((m) => Number(m[1])));
}

/** Review rounds per merged step (the rounds of its tasks added), their median, and the steps with a task past the limit. */
export function reviewRoundLines(steps: string[], tasks: { title: string; facts?: string }[], limit: number): string[] {
  const of = (id: string) => tasks.filter((t) => t.title.startsWith(`${id} `)).map((t) => roundsNamed(t.facts));
  const per = steps.map((id) => of(id).reduce((n, r) => n + r, 0)).sort((a, b) => a - b);
  if (per.length === 0) return ["review rounds: no merged steps"];
  const mid = per.length >> 1;
  const median = per.length % 2 ? (per[mid] ?? 0) : ((per[mid - 1] ?? 0) + (per[mid] ?? 0)) / 2;
  const over = steps.filter((id) => of(id).some((r) => r > limit)).length;
  return [`review rounds per merged step: median ${median}, most ${per[per.length - 1]}, ${over} steps with a task over the limit of ${limit}`];
}

/** Counts each merged step once, in the group of steps planned with the check (a check answer exists) or before it. */
export function stepCheckNumbers(i: StepCheckInput): StepCheckNumbers {
  const out: StepCheckNumbers = { before: empty(), withCheck: empty(), unpriced: [] };
  const unpriced = new Set<string>();
  for (const id of i.steps) {
    const checks = i.checks.filter((c) => c.step === id);
    const g = checks.length > 0 ? out.withCheck : out.before;
    const tasks = i.tasks.filter((t) => t.title.startsWith(`${id} `));
    const ids = new Set(tasks.map((t) => t.id));
    const branches = new Set(tasks.map((t) => branchOf(t.worktree)));
    g.steps++;
    g.noGos += checks.filter((c) => !c.go).length;
    g.reviewRounds += tasks.reduce((n, t) => n + findingRounds(t.facts), 0);
    g.refusedMerges += i.failedMerges.filter((b) => branches.has(b)).length;
    g.reverts += i.reverts.filter((s) => new RegExp(`\\b${id}\\b`).test(s)).length;
    g.questions += i.askTasks.filter((t) => t !== undefined && ids.has(t)).length;
    for (const c of checks) {
      g.tokens += c.tokensIn + c.tokensOut;
      const dollars = i.dollarsOf(c.model, c.tokensIn, c.tokensOut);
      if (dollars === undefined) unpriced.add(c.model);
      else g.dollars += dollars;
    }
  }
  out.unpriced = [...unpriced].sort();
  return out;
}

/** Steps planned with the check that have to be merged before it is judged. */
const JUDGED_AFTER = 20;

export type StepCheckVerdict = { kind: "waiting"; steps: number } | { kind: "keep" | "off"; savedDollars: number; checkDollars: number; reason: string };

const perStep = (g: CheckGroup, v: number) => (g.steps === 0 ? 0 : v / g.steps);
const reworkOf = (g: CheckGroup) => g.reviewRounds + g.refusedMerges + g.reverts;

/**
 * The check stays only when its dollars are below the dollars of the rework rounds it saved (the drop in rework per
 * step against the steps before, times the steps with the check, times the price of a round) and owner questions per
 * step did not rise. A round is priced as the mean merged step, since a round redoes about that much work.
 */
export function stepCheckVerdict(n: StepCheckNumbers, roundDollars: number): StepCheckVerdict {
  const w = n.withCheck;
  if (w.steps < JUDGED_AFTER) return { kind: "waiting", steps: w.steps };
  const savedRounds = Math.max(0, perStep(n.before, reworkOf(n.before)) - perStep(w, reworkOf(w))) * w.steps;
  const savedDollars = savedRounds * roundDollars;
  const questionsRose = perStep(w, w.questions) > perStep(n.before, n.before.questions);
  const keep = w.dollars < savedDollars && !questionsRose;
  const reason = questionsRose
    ? "owner questions per step rose"
    : keep
      ? "it cost less than the rework it saved"
      : "it cost at least as much as the rework it saved";
  return { kind: keep ? "keep" : "off", savedDollars, checkDollars: w.dollars, reason };
}

/** One line per group: the counts, and per merged step the rework and the cost of the check. */
export function stepCheckLines(n: StepCheckNumbers, roundDollars = 0): string[] {
  const line = (name: string, g: CheckGroup) => {
    if (g.steps === 0) return `step check, ${name}: no merged steps`;
    const per = (v: number) => (v / g.steps).toFixed(2);
    const rework = g.reviewRounds + g.refusedMerges + g.reverts;
    return `step check, ${name}: ${g.steps} steps, ${g.noGos} no-gos, ${rework} rework rounds (${g.reviewRounds} review, ${g.refusedMerges} refused merges, ${g.reverts} reverts), ${g.questions} owner questions, check ${Math.round(g.tokens)} tokens, $${g.dollars.toFixed(2)}; per step: rework ${per(rework)}, questions ${per(g.questions)}, $${per(g.dollars)}`;
  };
  const lines = [line("planned before the check", n.before), line("planned with the check", n.withCheck)];
  const v = stepCheckVerdict(n, roundDollars);
  lines.push(
    v.kind === "waiting"
      ? `step check, verdict: waiting, ${v.steps} of ${JUDGED_AFTER} steps planned with the check have merged`
      : `step check, verdict: ${v.kind === "keep" ? "keep" : "turn the model call off (lineclear project set <name> --step-check off)"}: check $${v.checkDollars.toFixed(2)}, rework saved $${v.savedDollars.toFixed(2)}; ${v.reason}`,
  );
  if (n.unpriced.length > 0) lines.push(`step check, no price for ${n.unpriced.join(", ")}: its dollars are not counted`);
  return lines;
}
