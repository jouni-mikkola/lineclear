import { serverBin } from "./paths.ts";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DISPATCHER_MODEL, dispatcherDir } from "./dispatcher.ts";
import { planProblems, plansAreAuto, readiness, stepFormProblems } from "./autoplan.ts";
import { applyPlan } from "./plan-apply.ts";
import { addItem, isOpen, readItems } from "./inbox.ts";
import { readSettings } from "./project.ts";
import { looseNote, resolveProject } from "./resolve.ts";
import { liveLink, readRequests, recordRequest } from "./requests.ts";
import { planBrief } from "./plan-brief.ts";
import { checkRoadmap } from "./roadmap.ts";
import { checkSteps, NOGO_ROUNDS, type StepCheck, type StepCheckInput, type StepVerdict } from "./stepcheck.ts";
import { decisionsPath } from "../pi/config.ts";
import type { Decision } from "./rules.ts";
import { configDir } from "../pi/config.ts";
import { clearWait, findProject, findTask, writeWait } from "./waits.ts";
import { mainBranch, mainRef } from "./main-branch.ts";
import { git } from "./git.ts";

const USAGE = ['usage: lineclear plan [--url <url>] <project> "<goal>"', "       lineclear plan [--url <url>] submit"];

const NO_SERVER = "lineclear plan: no Lineclear server is running here; start it with: lineclear serve";

/** True when the server command cannot reach a server: it exits 2 and says so, whatever address it tried. */
function serverIsDown(env: NodeJS.ProcessEnv): boolean {
  const p = Bun.spawnSync([serverBin(env), "task", "list", "--json"], { stdin: "ignore", env });
  return p.exitCode === 2 && p.stderr.toString().startsWith("Cannot reach the lineclear command");
}

const lineclear = serverBin;
/** `lineclear plan <project> "<goal>"` hands the goal to the Dispatcher, which writes the steps. No task starts. `lineclear plan submit` sends its roadmap change to the Inbox. */
export function planMain(raw: string[], out: (l: string) => void, baseEnv = process.env, cwd = process.cwd(), now: () => Date = () => new Date()): number {
  // the flag first, then the environment, then the data folder's record: the server's own command reads the last two
  const at = raw.indexOf("--url");
  if (at >= 0 && !raw[at + 1]) return (USAGE.forEach((l) => out(l)), 2);
  const args = at >= 0 ? raw.filter((_, i) => i !== at && i !== at + 1) : raw;
  const env = at >= 0 ? { ...baseEnv, LINECLEAR_URL: raw[at + 1] } : baseEnv;
  if (args[0] === "--help" || args[0] === "-h") return (USAGE.forEach((l) => out(l)), 0);
  if (args[0] === "submit") return args.length === 1 ? submit(out, env, cwd, now) : (USAGE.forEach((l) => out(l)), 2);
  const [rawName, goal, ...extra] = args;
  if (!rawName || !goal?.trim() || extra.length > 0) return (USAGE.forEach((l) => out(l)), 2);
  const project = resolveProject(rawName, env);
  if ("error" in project) return (out(`lineclear plan: ${project.error}`), 1);
  const name = project.name;
  const settings = readSettings(name, env);
  if (typeof settings === "string") return (out(`lineclear plan: ${settings}`), 1);
  const id = `PLAN-${readRequests(env).length + 1}`;
  const dir = dispatcherDir(env);
  const by = env.LINECLEAR_ROLE === "dispatcher" || cwd === dir || cwd.startsWith(`${dir}/`) ? "dispatcher" : "cli";
  recordRequest({ task: id, project: name, goal: goal.trim(), since: now().toISOString(), by }, env);
  // The Dispatcher writes the steps itself: the brief goes back to its chat as this command's answer, and no task starts.
  out(planBrief(name, goal.trim(), settings.repo, id));
  out(`live: ${liveLink(name, id)}`);
  out(`where it stands: lineclear status --plan ${id}${looseNote([[rawName, name]])}`);
  return 0;
}

function submit(out: (l: string) => void, env: NodeJS.ProcessEnv, cwd: string, now: () => Date): number {
  const fail = (m: string) => (out(`lineclear plan submit: ${m}`), 1);
  if (serverIsDown(env)) return (out(NO_SERVER), 1);
  const task = findTask(cwd, env);
  if (task === undefined) return fail("cannot tell which task this is, run it in the plan's worktree with LINECLEAR_TASK set to its plan id");
  const project = findProject(cwd, env);
  const top = git(cwd, "rev-parse", "--show-toplevel");
  if (!top.ok) return fail("this folder is not a git repository");
  const root = top.out.trim();
  const file = join(root, "docs", "ROADMAP.md");
  if (!existsSync(file)) return fail("docs/ROADMAP.md does not exist");
  if (git(root, "status", "--porcelain", "--", "docs/ROADMAP.md").out.trim() !== "") return fail("commit your change to docs/ROADMAP.md first");
  const base = mainRef(root);
  if (base === undefined) return fail(`cannot find ${mainBranch(root)} to compare with`);
  const fork = git(root, "merge-base", base, "HEAD").out.trim() || base;
  const was = git(root, "show", `${fork}:docs/ROADMAP.md`);
  const text = readFileSync(file, "utf8");
  const missing = stepFormProblems(was.ok ? was.out : "", text);
  if (missing.length > 0) {
    logDecision(task, project, `plan sent back, a step is not whole: ${missing.join(" | ")}`, env, now);
    return fail(
      `the plan goes back to the Dispatcher, each new or changed step must be whole. Fix these, commit and run 'lineclear plan submit' again:\n${missing.join("\n")}`,
    );
  }
  const errors = checkRoadmap(text).errors;
  if (errors.length > 0) return fail(`the roadmap does not pass the check:\n${errors.map((e) => `docs/ROADMAP.md:${e.line}: ${e.message}`).join("\n")}`);
  const diff = git(root, "diff", `${base}...HEAD`, "--", "docs/ROADMAP.md").out;
  if (diff.trim() === "") return fail("docs/ROADMAP.md has no change from main");
  const files = git(root, "diff", "--name-only", `${base}...HEAD`).out.trim().split("\n");
  if (files.some((f) => f !== "docs/ROADMAP.md")) return fail("a plan changes docs/ROADMAP.md only, undo the change to the other files");
  if (readItems(env).some((i) => i.kind === "plan" && i.task === task && isOpen(i))) return fail("this plan waits for the owner already");
  const head = git(root, "rev-parse", "HEAD").out.trim();
  const round = readItems(env).filter((i) => i.kind === "plan" && i.task === task).length + 1;
  if (round > 2) return fail("the plan was already sent back once; this plan ends");
  const settings = project ? readSettings(project, env) : undefined;
  const before = was.ok ? was.out : "";
  const reviewers = typeof settings === "object" ? settings.models.reviewer : [];
  const read = stepCheckOf(settings, { task, root, before, after: text, planner: DISPATCHER_MODEL, reviewers, env });
  if (read.kind === "refused") {
    // a plan held as Ready to merge is watched by no stall check, so the failure is recorded as a stall of its own
    logStall(task, project, `the fresh-model step check cannot run: ${read.why}`, env, now);
    return fail(`the fresh-model step check cannot run: ${read.why}`);
  }
  if (read.kind === "no-go") {
    logDecision(task, project, `plan sent back, a fresh reader says no-go: ${read.lines.join(" | ")}`, env, now);
    return fail(
      `the plan goes back to the Dispatcher, a fresh reader found a step unclear. Fix these, commit and run 'lineclear plan submit' again:\n${read.lines.join("\n")}`,
    );
  }
  if (read.kind === "ended") return endPlan(task, project, read, out, env, now);
  const checks = read.checks;
  if (plansAreAuto(project, env)) return autoApply({ task, project: project!, root, base, diff, head, round, text, checks }, out, env, now);
  const since = now().toISOString();
  const question = `Approve this roadmap change${project ? ` for ${project}` : ""}?`;
  const item = addItem({ kind: "plan", task, project, question, choices: ["Approve", "Reject"], diff, head, round, since, checks }, env);
  clearWait(task, env);
  writeWait({ task, project, kind: "owner", reason: `asked: ${question}`, since }, env);
  out(`inbox ${item.n}: ${question} End your turn; the answer comes as a message.`);
  return 0;
}

/** The step check's verdict, or a go with no answers when the project turned its model call off. */
function stepCheckOf(settings: ReturnType<typeof readSettings> | undefined, i: StepCheckInput): StepVerdict {
  return typeof settings === "object" && settings.stepCheck === false ? { kind: "go", checks: [] } : checkSteps(i);
}

/** Three rounds of no-go: the planning task ends with a report naming the step and why, and the owner gets nothing in the Inbox. */
function endPlan(
  task: string,
  project: string | undefined,
  r: { step: string; why: string },
  out: (l: string) => void,
  env: NodeJS.ProcessEnv,
  now: () => Date,
): number {
  const reason = `step ${r.step} stayed unclear after ${NOGO_ROUNDS} rounds: ${r.why}`;
  logDecision(task, project, `planning task ended, ${reason}`, env, now);
  Bun.spawnSync([lineclear(env), "task", "close", task], { stdin: "ignore" });
  clearWait(task, env);
  out(`report: ${task} ended with no plan. ${reason}`);
  return 0;
}

/** Writes one line to decisions.jsonl, where the rule loop logs its choices. */
function logDecision(task: string, project: string | undefined, reason: string, env: NodeJS.ProcessEnv, now: () => Date): void {
  mkdirSync(configDir(env), { recursive: true });
  const d: Decision = { time: now().toISOString(), project: project ?? "-", step: task, kind: "skip", reason };
  appendFileSync(decisionsPath(env), `${JSON.stringify(d)}\n`);
}

function logStall(task: string, project: string | undefined, reason: string, env: NodeJS.ProcessEnv, now: () => Date): void {
  mkdirSync(configDir(env), { recursive: true });
  const d: Decision = { time: now().toISOString(), project: project ?? "-", step: task, kind: "stall", event: "stall", class: "command-failed", reason };
  appendFileSync(decisionsPath(env), `${JSON.stringify(d)}\n`);
}

interface Auto {
  task: string;
  project: string;
  root: string;
  base: string;
  diff: string;
  head: string;
  round: number;
  text: string;
  checks: StepCheck[];
}

/** A project that does not ask before plans: the rule checks and the readiness check say go, then the plan merges and the owner may undo it. */
function autoApply(a: Auto, out: (l: string) => void, env: NodeJS.ProcessEnv, now: () => Date): number {
  const fail = (m: string) => (out(`lineclear plan submit: ${m}`), 1);
  // compare with where the branch left main, so steps main gained since do not look removed
  const fork = git(a.root, "merge-base", a.base, a.head).out.trim() || a.base;
  const was = git(a.root, "show", `${fork}:docs/ROADMAP.md`);
  const problems = planProblems(was.ok ? was.out : "", a.text);
  if (problems.length > 0) return fail(`the rule checks refuse this plan, fix these, commit and run 'lineclear plan submit' again:\n${problems.join("\n")}`);
  const verdict = readiness(a.diff, a.project, env);
  if (!verdict.go) return fail(`the readiness check says no-go: ${verdict.why}. Fix that, commit and run 'lineclear plan submit' again.`);
  const settings = readSettings(a.project, env);
  if (typeof settings === "string") return fail(settings);
  const question = `Roadmap change from ${a.task} applied for ${a.project}`;
  const r = applyPlan(
    {
      kind: "plan",
      task: a.task,
      project: a.project,
      question,
      choices: ["Approve", "Reject"],
      diff: a.diff,
      head: a.head,
      round: a.round,
      since: now().toISOString(),
      checks: a.checks,
    },
    settings.repo,
    now(),
    env,
  );
  if ("error" in r) return fail(`the plan passed the checks but did not merge: ${r.error}`);
  out(
    `inbox ${r.item.n}: ${question}. It passed the rule checks and the readiness check, so it applied by itself and the owner can undo it with one tap. End your turn.`,
  );
  return 0;
}
