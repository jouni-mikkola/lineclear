import { READER_ASK } from "./reader-ask.ts";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeAtomic } from "../pi/atomic.ts";
import { join } from "node:path";
import { ANSWER_MAX_TOKENS, askModel, INPUT_MAX_TOKENS } from "./ask-model.ts";
import { changedSteps } from "./autoplan.ts";
import { providerOf } from "./full.ts";
import { company } from "./company.ts";
import { availability } from "./stalls.ts";
import type { Step } from "./roadmap.ts";
import { configDir } from "../pi/config.ts";
import { gitText } from "./git.ts";

/** What one step check may read and say, in tokens (counted as a quarter of the characters). */
/** A planning task ends when its steps drew a no-go in this many rounds. */
export const NOGO_ROUNDS = 3;

export const tokensOf = (s: string) => Math.ceil(s.length / 4);

/** One answer of the checking model, kept next to the plan. */
export interface StepCheck {
  step: string;
  /** The step's text when it was asked, so an unchanged step is not asked again. */
  key: string;
  round: number;
  model: string;
  go: boolean;
  /** The step said back in the model's words. */
  said: string;
  /** For a no-go: what is missing. */
  missing: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * The rule: the first model of the reviewer's list with room from another company than the planner's. When none has
 * room, a model of the planner's own company in a fresh session, another account before another model of the same one.
 * When the planner's model is not known, the first with room. Undefined only when the list is empty.
 */
export function pickChecker(planner: string | undefined, reviewers: string[], usable: (model: string) => boolean = () => true): string | undefined {
  const ok = reviewers.filter(usable);
  if (!planner) return ok[0] ?? reviewers[0];
  return (
    ok.find((m) => company(m) !== company(planner)) ??
    ok.find((m) => providerOf(m) !== providerOf(planner)) ??
    ok.find((m) => m !== planner) ??
    ok[0] ??
    reviewers.find((m) => company(m) !== company(planner)) ??
    reviewers[0]
  );
}

const render = (s: Step): string => [`### ${s.id} ${s.title}`, ...Object.entries(s.fields).flatMap(([k, f]) => [`- ${k}: ${f.value}`, ...f.more])].join("\n");

/** How a Scales finding is told: on a line of its own, before the last line. */
const SCALES_ASK =
  "Also read the step against the Scales lines below. If it breaks one, put a line `SCALES: <the line it breaks>: <why>` before the last line.";

/** The "Scales" section of docs/design.md, its heading and lines; empty when the repo has none. */
export function scalesOf(root: string): string {
  const f = join(root, "docs", "design.md");
  if (!existsSync(f)) return "";
  const text = readFileSync(f, "utf8");
  const start = text.search(/^## Scales$/m);
  if (start < 0) return "";
  const next = text.indexOf("\n## ", start + 1);
  return text.slice(start, next < 0 ? undefined : next).trim();
}

/** The question for one step: the step and the repo's map, the map cut to fit INPUT_MAX_TOKENS. */
export function stepQuestion(step: Step, agents: string, files: string[], scales: string): string {
  const head = [
    "You are a fresh reader of one step of a project's roadmap. You did not write it and you see only the step and the repo's map.",
    READER_ASK,
    `Keep the whole answer under ${ANSWER_MAX_TOKENS * 3} characters.`,
    SCALES_ASK,
    "",
    scales,
    "",
    "STEP",
    render(step),
    "",
  ].join("\n");
  const room = Math.max(0, INPUT_MAX_TOKENS * 4 - head.length - 40);
  const map = `MAP\nAGENTS.md:\n${agents}\n\nTracked files:\n${files.join("\n")}`;
  return head + map.slice(0, room);
}

export interface Answer {
  go: boolean;
  said: string;
  missing: string;
}

/** A `SCALES: <line>: <why>` line in an answer, as the reason it gives. */
const scalesFinding = (text: string): string | undefined => {
  const f = /^SCALES:\s*(\S.*)$/im.exec(text)?.[1]?.trim();
  return f ? `Scales: ${f}` : undefined;
};

/** Reads `SAID: ...` and the last `GO` or `NO-GO: ...` line; an answer in no such form is a no-go. */
export function readAnswer(text: string): Answer {
  const scales = scalesFinding(text);
  if (scales) return { go: false, said: /^SAID:\s*(.*)$/im.exec(text)?.[1]?.trim() ?? "", missing: scales };
  const said = /^SAID:\s*([\s\S]*?)(?=\n\s*(?:NO-GO|GO)\b|$)/im.exec(text)?.[1]?.trim() ?? "";
  const last =
    text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? "";
  if (/^GO\b/i.test(last)) return { go: true, said, missing: "" };
  const missing = /^NO-GO:?\s*(.*)$/i.exec(last)?.[1]?.trim();
  return { go: false, said, missing: missing || "the answer did not say go or no-go; say the step back, then end with GO or NO-GO: <what is missing>" };
}

/**
 * One short call. `LINECLEAR_STEPCHECK` is a shell command that reads the question on stdin and gets the model in
 * `LINECLEAR_STEPCHECK_MODEL`; else `pi -p`. An error line when the model did not answer.
 */
function callModel(model: string, question: string, env: NodeJS.ProcessEnv): { text: string } | { error: string } {
  const run = askModel(question, model, env.LINECLEAR_STEPCHECK, "LINECLEAR_STEPCHECK_MODEL", env);
  const text = run.stdout.toString().trim();
  if (run.exitCode === 0 && text) return { text };
  return { error: `${model} did not answer${run.stderr.toString().trim() ? `: ${run.stderr.toString().trim().split("\n")[0]}` : ""}` };
}

const hasVerdict = (text: string): boolean =>
  /^(?:NO-)?GO\b/i.test(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? "",
  );

/** An empty or verdict-less answer is a failed call, not a no-go: it is asked once more of the next model. */
function askWithRetry(model: string, retryModel: string, question: string, env: NodeJS.ProcessEnv): { text: string; model: string } | { error: string } {
  const first = callModel(model, question, env);
  if ("text" in first && hasVerdict(first.text)) return { text: first.text, model };
  const second = callModel(retryModel, question, env);
  if ("text" in second) return { text: second.text, model: retryModel };
  return "text" in first ? { text: first.text, model } : second;
}

interface Checks {
  rounds: number;
  answers: StepCheck[];
}

const recordPath = (task: string, env: NodeJS.ProcessEnv) => join(configDir(env), "plan-checks", `${task}.json`);

/** Every answer of a planning task so far and how many rounds drew a no-go. */
function readChecks(task: string, env = process.env): Checks {
  const f = recordPath(task, env);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Checks) : { rounds: 0, answers: [] };
}

export type StepVerdict =
  | { kind: "go"; checks: StepCheck[] }
  | { kind: "no-go"; lines: string[] }
  | { kind: "ended"; step: string; why: string }
  | { kind: "refused"; why: string };

export interface StepCheckInput {
  task: string;
  root: string;
  before: string;
  after: string;
  planner: string | undefined;
  reviewers: string[];
  env: NodeJS.ProcessEnv;
}

const trackedFiles = (root: string) => (gitText(root, "ls-files") ?? "").split("\n").filter(Boolean);

/**
 * Asks a model, from another company than the planner's when one has room, about each new or changed step that has no go yet. A no-go
 * goes back to the planner; the third round with one ends the task.
 */
export function checkSteps(i: StepCheckInput): StepVerdict {
  const model = pickChecker(i.planner, i.reviewers, (m) => availability(m, i.env) === "ok");
  if (!model) {
    return {
      kind: "refused",
      why: "no checker: the project's reviewer model list is empty. Add a model in the project's settings.",
    };
  }
  const rest = i.reviewers.filter((m) => m !== model);
  const retryModel = pickChecker(i.planner, rest, (m) => availability(m, i.env) === "ok") ?? i.planner ?? model;
  const record = readChecks(i.task, i.env);
  const round = record.rounds + 1;
  const agents = existsSync(join(i.root, "AGENTS.md")) ? readFileSync(join(i.root, "AGENTS.md"), "utf8") : "";
  const files = trackedFiles(i.root);
  const scales = scalesOf(i.root);
  const fresh: StepCheck[] = [];
  for (const step of changedSteps(i.before, i.after)) {
    const key = render(step);
    if (record.answers.some((a) => a.go && a.step === step.id && a.key === key)) continue;
    const question = stepQuestion(step, agents, files, scales);
    const got = askWithRetry(model, retryModel, question, i.env);
    if ("error" in got) return { kind: "refused", why: got.error };
    const answer = readAnswer(got.text);
    const cap = (t: string) => t.slice(0, ANSWER_MAX_TOKENS * 4);
    fresh.push({
      step: step.id,
      key,
      round,
      model: got.model,
      go: answer.go,
      said: cap(answer.said),
      missing: cap(answer.missing),
      tokensIn: tokensOf(question),
      tokensOut: tokensOf(cap(got.text)),
    });
  }
  const bad = fresh.filter((a) => !a.go);
  const rounds = bad.length > 0 ? round : record.rounds;
  const dir = join(configDir(i.env), "plan-checks");
  mkdirSync(dir, { recursive: true });
  writeAtomic(recordPath(i.task, i.env), `${JSON.stringify({ rounds, answers: [...record.answers, ...fresh] }, null, 2)}\n`);
  if (bad.length > 0 && round >= NOGO_ROUNDS) {
    return { kind: "ended", step: bad[0]?.step ?? "", why: bad[0]?.missing ?? "" };
  }
  if (bad.length > 0) {
    return { kind: "no-go", lines: bad.map((a) => `step ${a.step}: a fresh reader (${a.model}) read it as "${a.said}" and says no-go, missing: ${a.missing}`) };
  }
  const now = new Set(changedSteps(i.before, i.after).map((s) => `${s.id}\n${render(s)}`));
  return { kind: "go", checks: [...record.answers, ...fresh].filter((a) => a.go && now.has(`${a.step}\n${a.key}`)) };
}

/** The merge check's question: the Scales section against one part of the change's diff. */
function diffQuestion(part: string, scales: string): string {
  return [
    "You are a fresh reviewer of a change about to merge. You see only its diff.",
    "Read it against the Scales lines below. If it breaks one, answer `SCALES: <the line it breaks>: <why>` on a line of its own, then `NO-GO`. If it breaks none, answer `GO`.",
    "",
    scales,
    "",
    "DIFF",
    part,
  ].join("\n");
}

/** The diff in parts that each fit the input size, so no part of it goes unread. */
function diffParts(diff: string, scales: string): string[] {
  const room = Math.max(1000, INPUT_MAX_TOKENS * 4 - diffQuestion("", scales).length - 40);
  const parts: string[] = [];
  for (let at = 0; at < diff.length; at += room) parts.push(diff.slice(at, at + room));
  return parts;
}

/**
 * The merge check: undefined when every part of the diff keeps the Scales lines, else the reason that refuses the merge.
 * An answer with no verdict refuses too. A checker that does not answer at all (no quota, no network) is `unavailable`:
 * a merge must not wait on a model's account.
 */
export function checkDiffScales(root: string, diff: string, model: string, env: NodeJS.ProcessEnv): { refused: string } | { unavailable: string } | undefined {
  const scales = scalesOf(root);
  if (!scales || !diff.trim()) return undefined;
  for (const part of diffParts(diff, scales)) {
    const got = callModel(model, diffQuestion(part, scales), env);
    if ("error" in got) return { unavailable: got.error };
    const finding = scalesFinding(got.text);
    if (finding) return { refused: finding };
    if (!hasVerdict(got.text)) return { refused: "Scales: the checker's answer had no GO or NO-GO" };
    const answer = readAnswer(got.text);
    if (!answer.go) return { refused: `Scales: the checker said no-go: ${answer.missing}` };
  }
  return undefined;
}
