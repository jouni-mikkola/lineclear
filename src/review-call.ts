import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { askModel } from "./ask-model.ts";
import { company } from "./company.ts";
import { git, gitText } from "./git.ts";
import { dataDir, serverBin } from "./paths.ts";
import { readRegistry } from "./models.ts";
import { pickReviewer } from "./stalls.ts";
import { recordWork } from "./task-work.ts";

// A review is one model call: the brief, the diff and the repo's rules in, tagged findings out. No tools, no files read.

const SEVERITIES = ["critical", "major", "minor", "trivial"] as const;
type Severity = (typeof SEVERITIES)[number];

export interface Finding {
  severity: Severity;
  file: string;
  line: number;
  why: string;
}

const RULE_FILES = ["AGENTS.md", "CLAUDE.md", "REVIEW.md"];
const CONTEXT_LINES = 8;
const LIGHT_CONTEXT_LINES = 3;
/** A diff with fewer changed lines than this, and no deleted test, gets the light form. */
const LIGHT_MAX_CHANGED = 80;
/** The light form cuts the rules and the brief to this many characters each. */
const LIGHT_PART_MAX = 6_000;
/** The diff and the rules are cut to this many characters each, to keep a review's input small and a huge change from overflowing the model. */
const PART_MAX = 60_000;

/** The repo's own rules, each file under its name. */
function repoRules(repo: string): string {
  return RULE_FILES.filter((f) => existsSync(join(repo, f)))
    .map((f) => `--- ${f}\n${readFileSync(join(repo, f), "utf8")}`)
    .join("\n");
}

function cut(text: string, max = PART_MAX): string {
  return text.length > max ? `${text.slice(0, max)}\n(cut here)` : text;
}

/** Lines added or removed, and whether a test file or a test case goes away. */
function diffShape(diff: string): { changed: number; deletesTest: boolean } {
  const lines = diff.split("\n");
  const changed = lines.filter((l) => /^[+-](?![+-]{2} )/.test(l)).length;
  const goneFile = diff.split(/^(?=diff --git )/m).some((p) => /^deleted file mode/m.test(p) && /^diff --git a\/\S*(test|spec)/im.test(p));
  const goneCase = lines.some((l) => /^-\s*(test|it|describe)(\.\w+)?\(/.test(l));
  return { changed, deletesTest: goneFile || goneCase };
}

/** The change since the branch left its base, with 8 lines of context, committed or not. */
function diffAgainst(repo: string, base: string, context = CONTEXT_LINES): string | undefined {
  const ref = [`origin/${base}`, base].find((r) => git(repo, "rev-parse", "--verify", "--quiet", r).ok);
  const from = ref && gitText(repo, "merge-base", ref, "HEAD");
  if (!from) return undefined;
  // new files are not in `git diff`; they are added from git's own listing, leaving the index as it was
  const fresh = git(repo, "ls-files", "--others", "--exclude-standard").out.split("\n").filter(Boolean);
  const added = fresh.map((f) => git(repo, "diff", "--no-index", `-U${context}`, "--", "/dev/null", f).out);
  return [git(repo, "diff", `-U${context}`, from).out, ...added].join("");
}

/** The step and the owner's direction, without the worker's procedure that follows them: a reviewer never runs it. */
function stepOfBrief(brief: string): string {
  const at = brief.indexOf("This step was checked by a fresh model");
  return (at < 0 ? brief : brief.slice(0, at)).trim();
}

function reviewQuestion(brief: string, diff: string, rules: string, light: boolean): string {
  const max = light ? LIGHT_PART_MAX : PART_MAX;
  return [
    "You review a code change. You have no tools: everything you need is below. Report what this change broke, left undone or added beyond the brief, each with proof from the diff.",
    "Tag each finding critical (breaks or loses users' work), major (a user would hit it, or it proves a claim false), minor (rarely hit) or trivial (style).",
    "Answer with one line per finding and nothing else, in the form:",
    "FINDING <critical|major|minor|trivial> | <file> | <line in the new file> | <why, with the proof>",
    "No finding: answer the single line NONE.",
    "",
    "BRIEF",
    light ? cut(stepOfBrief(brief), max) : stepOfBrief(brief),
    "",
    "THE REPO'S RULES",
    cut(rules, max) || "(none)",
    "",
    "DIFF",
    cut(diff),
  ].join("\n");
}

/** Reads `FINDING severity | file | line | why` lines; any other line is ignored. */
export function readFindings(text: string): Finding[] {
  const found: Finding[] = [];
  for (const l of text.split("\n")) {
    const m = /^\s*FINDING\s+(critical|major|minor|trivial)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*(.+?)\s*$/i.exec(l);
    if (m) found.push({ severity: m[1]?.toLowerCase() as Severity, file: m[2] as string, line: Number.parseInt(m[3] as string, 10) || 0, why: m[4] as string });
  }
  return found;
}

export const reviewPath = (task: string, env: NodeJS.ProcessEnv = process.env) => join(dataDir(env), "reviews", `${task}.json`);

/** The model a Settings line of the brief names, e.g. "- Reviewer: a headless pi ... (model x/y, ...)". */
export function briefModel(brief: string, line: "Reviewer" | "Agent"): string | undefined {
  return new RegExp(`^- ${line}:.*?\\(model ([^\\s,)]+)`, "m").exec(brief)?.[1];
}

export interface ReviewInput {
  task: string;
  repo: string;
  base: string;
  brief: string;
  /** The reviewer the settings name; another model is picked when it is of the worker's company and one is not. */
  reviewer?: string;
  worker?: string;
}

/** The asked reviewer, or when it is of the worker's company the first model the harnesses offer from another one. */
function otherCompany(worker: string | undefined, reviewer: string | undefined): string | undefined {
  if (!worker || !reviewer || company(reviewer) !== company(worker)) return reviewer;
  const offered = readRegistry().map((m) => `${m.provider}/${m.name}`);
  return pickReviewer(worker, [reviewer, ...offered], undefined) ?? reviewer;
}

type Reviewed =
  | { ok: true; findings: Finding[]; model: string | undefined; note?: string; inputTokens: number; form: "light" | "full" }
  | { ok: false; error: string };

/** One review call. The findings are stored as JSON; the note says when the reviewer is of the worker's company. */
export function review(i: ReviewInput, env: NodeJS.ProcessEnv = process.env): Reviewed {
  let diff = diffAgainst(i.repo, i.base, LIGHT_CONTEXT_LINES);
  if (diff === undefined) return { ok: false, error: `no base ${i.base} to compare with` };
  if (diff.trim() === "") return { ok: false, error: `${i.task} has no changes against ${i.base}` };
  const shape = diffShape(diff);
  const light = shape.changed < LIGHT_MAX_CHANGED && !shape.deletesTest;
  if (!light) diff = diffAgainst(i.repo, i.base) ?? diff;
  const model = otherCompany(i.worker, i.reviewer);
  const note = model && i.worker && company(model) === company(i.worker) ? `the reviewer ${model} is from the worker's company` : undefined;
  const question = reviewQuestion(i.brief, diff, repoRules(i.repo), light);
  const run = askModel(question, model, env.LINECLEAR_REVIEW, "LINECLEAR_REVIEW_MODEL", env);
  const text = run.stdout.toString().trim();
  if (run.exitCode !== 0 || text === "")
    return { ok: false, error: `the reviewer did not answer: ${run.stderr.toString().trim().split("\n")[0] || "no output"}` };
  const findings = readFindings(text);
  if (findings.length === 0 && !/^\s*NONE\s*$/im.test(text))
    return { ok: false, error: `the reviewer's answer had no findings in the form asked for: ${text.slice(0, 200)}` };
  const inputTokens = Math.ceil(question.length / 4);
  const form = light ? "light" : "full";
  recordWork(i.task, "review", env);
  const path = reviewPath(i.task, env);
  mkdirSync(dirname(path), { recursive: true });
  writeAtomic(path, `${JSON.stringify({ task: i.task, model, time: new Date().toISOString(), inputTokens, form, findings }, null, 2)}\n`);
  return { ok: true, findings, model, note, inputTokens, form };
}

/** `lineclear review <task>`: run in the task's worktree; the brief comes from the board. */
export function reviewMain(rest: string[], out: (line: string) => void, env: NodeJS.ProcessEnv = process.env): number {
  const task = rest[0];
  const at = rest.indexOf("--model");
  const asked = at < 0 ? undefined : rest[at + 1];
  const json = rest.includes("--json");
  if (!task || task.startsWith("-") || (at >= 0 && !asked)) return (out("usage: lineclear review <task> [--model <provider/model>] [--json]"), 2);
  const shown = Bun.spawnSync([serverBin(env), "task", "show", task, "--json"], { env, stdin: "ignore" });
  if (shown.exitCode !== 0) return (out(`lineclear review: ${shown.stderr.toString().trim() || shown.stdout.toString().trim()}`), 1);
  let t: { desc?: string; base?: string };
  try {
    t = JSON.parse(shown.stdout.toString());
  } catch {
    return (out(`lineclear review: the board did not show ${task} as JSON`), 1);
  }
  const brief = t.desc ?? "";
  const r = review(
    {
      task,
      repo: process.cwd(),
      base: t.base ?? "main",
      brief,
      reviewer: asked ?? briefModel(brief, "Reviewer"),
      worker: asked ? undefined : briefModel(brief, "Agent"),
    },
    env,
  );
  if (!r.ok) return (out(`lineclear review: ${r.error}`), 1);
  if (json) return (out(JSON.stringify({ task, model: r.model, form: r.form, inputTokens: r.inputTokens, findings: r.findings })), 0);
  if (r.note) out(`note: ${r.note}`);
  out(`${r.findings.length} finding${r.findings.length === 1 ? "" : "s"} by ${r.model ?? "the default model"}, stored in ${reviewPath(task, env)}`);
  for (const f of r.findings) out(`${f.severity} ${f.file}:${f.line} ${f.why}`);
  return 0;
}
