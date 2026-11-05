import { askModel } from "./ask-model.ts";
import { serverBin } from "./paths.ts";
import { join } from "node:path";
import { ownerDirection } from "./direction.ts";
import { writeAtomic } from "../pi/atomic.ts";
import { addItem, closeItem, isOpen, readItems, type Item } from "./inbox.ts";
import { askBefore, readSettings } from "./project.ts";
import { checkRoadmap, parseRoadmap, resultOf, stepResultProblems, type Step } from "./roadmap.ts";
import { configDir } from "../pi/config.ts";
import { HEALTH_TAG, holdsPartsWhole, type Part, stepLocks, stepPartFaults, stepParts } from "./parts.ts";
import { clearWait } from "./waits.ts";

/** The step the longest chain is counted to: the last one of a roadmap that has it. */
const LAST_STEP = "U43";

const git = (cwd: string, ...a: string[]) =>
  Bun.spawnSync(["git", "-C", cwd, "-c", "user.name=Lineclear", "-c", "user.email=lineclear@localhost", ...a], { stdin: "ignore" });

const lines = (s: Step, field: string) => {
  const f = s.fields[field];
  return f ? [f.value, ...f.more].map((l) => l.trim().replace(/^[-*]\s+/, "")).filter(Boolean) : [];
};
const lockSet = (s: Step) => new Set(stepLocks(s).map((l) => l.toLowerCase()));

/** The repo's parts and the ones with the worst health, for the part rules of a plan. */
export interface PartsContext {
  parts: Part[];
  worst: string[];
}

/**
 * The part rules of a plan: each new or changed step names its parts and its files fall inside them, a new health
 * step is for a part with the worst health, and the roadmap keeps one health step in five.
 */
export function partProblems(old: Step[], next: Step[], ctx: PartsContext): string[] {
  if (ctx.parts.length === 0) return [];
  const problems: string[] = [];
  const oldById = new Map(old.map((s) => [s.id, s]));
  const same = (a: Step, b: Step) =>
    a.title === b.title &&
    JSON.stringify(Object.entries(a.fields).map(([k, f]) => [k, f.value, f.more])) ===
      JSON.stringify(Object.entries(b.fields).map(([k, f]) => [k, f.value, f.more]));
  for (const n of next) {
    const o = oldById.get(n.id);
    if (n.dropped || (o && same(o, n))) continue;
    const { names, health } = stepParts(n);
    if (names.length === 0) problems.push(`parts: step ${n.id} names no parts (one or more of ${ctx.parts.map((p) => p.name).join(", ")})`);
    problems.push(...stepPartFaults(n, ctx.parts).map((f) => `parts: ${f}`));
    const wasHealth = o ? stepParts(o).health : [];
    const fresh = health.filter((h) => !wasHealth.includes(h) && !ctx.worst.includes(h));
    if (fresh.length > 0 && ctx.worst.length > 0)
      problems.push(`parts: step ${n.id} is a health step for ${fresh.join(", ")}, but the worst health is ${ctx.worst.join(", ")}`);
  }
  const live = (steps: Step[]) => steps.filter((s) => !s.dropped && stepParts(s).names.length > 0);
  // one step in five of the steps that name parts is a health step
  const short = (steps: Step[]) => Math.floor(live(steps).length / 5) - live(steps).filter((s) => stepParts(s).health.length > 0).length;
  // a roadmap already short of health steps may not get shorter; one that was not may not start
  if (short(next) > 0 && short(next) > Math.max(0, short(old))) {
    problems.push(
      `parts: keep one step in five a health step (${HEALTH_TAG} after a part on its parts line): add one for ${ctx.worst.join(", ") || "the part with the worst health"}`,
    );
  }
  return problems;
}

/** The step the longest chain is counted to: U43, or else the last step that is not dropped. */
function lastStep(steps: Step[]): string | undefined {
  if (steps.some((s) => s.id === LAST_STEP)) return LAST_STEP;
  return [...steps].reverse().find((s) => !s.dropped)?.id;
}

/** Steps on the longest chain of `after` that ends at `target`, or undefined when the roadmap has no such step. */
export function longestChain(steps: Step[], target: string): number | undefined {
  const byId = new Map(steps.map((s) => [s.id, s]));
  if (!byId.has(target)) return undefined;
  const memo = new Map<string, number>();
  const depth = (id: string, seen: Set<string>): number => {
    const s = byId.get(id);
    if (!s || seen.has(id)) return 0;
    const known = memo.get(id);
    if (known !== undefined) return known;
    const next = new Set(seen).add(id);
    const n = 1 + Math.max(0, ...s.after.filter((a) => a !== "none").map((a) => depth(a, next)));
    memo.set(id, n);
    return n;
  };
  return depth(target, new Set());
}

const stepKey = (s: Step) => JSON.stringify([s.title, Object.entries(s.fields).map(([k, f]) => [k, f.value, f.more])]);

/** The steps of `after` that are new or differ from `before`, not counting dropped ones. */
export function changedSteps(before: string, after: string): Step[] {
  const old = new Map(parseRoadmap(before).steps.map((s) => [s.id, stepKey(s)]));
  return parseRoadmap(after).steps.filter((s) => !s.dropped && old.get(s.id) !== stepKey(s));
}

/**
 * The form of each new or changed step, with no model: one line per step that lists every part it misses (why, done
 * when with an item, locks, after with known ids, files naming a path). Empty when every such step is whole.
 */
export function stepFormProblems(before: string, after: string): string[] {
  const known = new Set(parseRoadmap(after).steps.map((s) => s.id));
  const out: string[] = [];
  for (const s of changedSteps(before, after)) {
    const missing: string[] = [];
    if (lines(s, "why").length === 0) missing.push("a why");
    if (lines(s, "done when").length === 0) missing.push("a done when with at least one item");
    if (lines(s, "locks").length === 0) missing.push("a locks line (write none if it touches no shared code)");
    if (s.after.length === 0) missing.push("an after line (write none to start at once)");
    const unknown = s.after.filter((a) => a !== "none" && !known.has(a));
    if (unknown.length > 0) missing.push(`known ids in after (unknown: ${unknown.join(", ")})`);
    if (!lines(s, "files").some((l) => /[./]/.test(l))) missing.push("a files line that names at least one path");
    if (holdsPartsWhole(s))
      missing.push(
        "locks that name the real areas it changes, or the part itself when the work needs all of it (a step with parts and no locks holds each part whole)",
      );
    if (missing.length > 0) out.push(`step ${s.id} needs ${missing.join("; ")}`);
    out.push(...stepResultProblems(s));
  }
  return out;
}

/**
 * The rule checks a roadmap change must pass to apply by itself, as lines of what is wrong (none when it passes):
 * form, locks, `after`, the longest chain to the last step not longer, and every done-when kept as strict.
 */
export function planProblems(before: string, after: string): string[] {
  const form = checkRoadmap(after);
  if (form.errors.length > 0) return form.errors.map((e) => `form: line ${e.line}: ${e.message}`);
  const old = checkRoadmap(before).parsed.steps;
  const next = form.parsed.steps;
  const nextById = new Map(next.map((s) => [s.id, s]));
  const oldById = new Map(old.map((s) => [s.id, s]));
  // a step that is new or whose title or result changed has a title and a result that fit
  const problems: string[] = next
    .filter((n) => {
      const o = oldById.get(n.id);
      return !o || o.title !== n.title || resultOf(o) !== resultOf(n);
    })
    .flatMap((n) => stepResultProblems(n).map((m) => `form: ${m}`));
  for (const o of old) {
    const n = nextById.get(o.id);
    if (!n) {
      problems.push(`form: step ${o.id} is gone; mark it dropped instead of deleting it`);
      continue;
    }
    const keptLocks = [...lockSet(o)].filter((l) => !lockSet(n).has(l));
    if (keptLocks.length > 0) problems.push(`locks: step ${o.id} lost the lock ${keptLocks.join(", ")}`);
    const had = lines(o, "done when");
    const has = new Set(lines(n, "done when"));
    const lost = had.filter((l) => !has.has(l));
    if (lost.length > 0 && !n.dropped) problems.push(`done when: step ${o.id} changed or lost a done-when line, a done-when stays as strict: "${lost[0]}"`);
  }
  for (const n of next) {
    if (oldById.has(n.id)) continue;
    if (lines(n, "done when").length === 0) problems.push(`done when: new step ${n.id} has no done-when test`);
    if (lines(n, "locks").length === 0 && lines(n, "parts").length === 0)
      problems.push(`locks: new step ${n.id} names no locks (write none if it touches no shared code)`);
    if (n.after.length === 0) problems.push(`after: new step ${n.id} names no after (write none to start at once)`);
  }
  const goal = lastStep(old);
  const was = goal ? longestChain(old, goal) : undefined;
  const is = goal ? longestChain(next, goal) : undefined;
  if (goal && was !== undefined && is !== undefined && is > was) problems.push(`after: the longest chain to ${goal} grew from ${was} to ${is} steps`);
  return problems;
}

/** The text of the fresh-eyes readiness check's question. */
export function readinessPrompt(diff: string, repo?: string): string {
  return [
    "You are a fresh pair of eyes on a change to a project's docs/ROADMAP.md. Nobody has to approve it: if you say GO it applies by itself, and the owner can undo it.",
    "Say GO when each added or changed step is small (one thing), has a why that holds for anyone, done-when tests anyone can check, honest locks and an `after` that lists what it really needs. Say NO-GO when the change goes against a line of the owner's direction below, or when a step is vague, too big, duplicates another, or its order is wrong.",
    "Answer with one line: `GO`, or `NO-GO: <the one thing to fix>`.",
    "",
    "",
    ownerDirection(repo),
    "",
    diff,
  ].join("\n");
}

/** Asks the readiness check. `LINECLEAR_READINESS` is a shell command that reads the question on stdin; else pi -p with the reviewer's first model. */
export function readiness(diff: string, project: string | undefined, env = process.env): { go: boolean; why: string } {
  const s = project ? readSettings(project, env) : undefined;
  const prompt = readinessPrompt(diff, typeof s === "object" ? s.repo : undefined);
  const model = typeof s === "object" ? (s.models.reviewer[0] ?? s.models.planner[0]) : undefined;
  const p = askModel(prompt, model, env.LINECLEAR_READINESS, "LINECLEAR_READINESS_MODEL", env);
  const text = p.stdout.toString().trim();
  if (p.exitCode !== 0 || !text)
    return { go: false, why: `the readiness check did not answer${p.stderr.toString().trim() ? `: ${p.stderr.toString().trim().split("\n")[0]}` : ""}` };
  const last = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1)!;
  return /^GO\b/i.test(last) ? { go: true, why: "" } : { go: false, why: last.replace(/^NO-GO:?\s*/i, "") || "no reason given" };
}

/** True when this project lets plans apply by themselves. */
export const plansAreAuto = (project: string | undefined, env = process.env): boolean => {
  if (!project) return false;
  const s = readSettings(project, env);
  return typeof s === "object" && !askBefore(s).plans;
};

const tip = (repo: string) => git(repo, "rev-parse", "HEAD").stdout.toString().trim();

/** Records a change that applied by itself, as an answered item on the Roadmap's list: the owner can undo it. */
export function recordApplied(
  item: Omit<Item, "n" | "answer" | "answeredAt" | "auto">,
  base: string,
  commit: string,
  now: Date,
  env = process.env,
  commits?: string[],
): Item {
  return addItem({ ...item, answer: "Approve", answeredAt: now.toISOString(), auto: true, base, commit, ...(commits ? { commits } : {}) }, env);
}

/** Merges a task by the server and returns the main commits it added, or an error line. */
function mergeTask(task: string, repo: string, env = process.env): { base: string; commit: string; commits?: string[] } | string {
  const base = tip(repo);
  const n = /-(\d+)$/.exec(task)?.[1];
  const subjects = new Set((n ? git(repo, "log", "--format=%s", `main..refs/heads/work/${n}-*`).stdout.toString().trim().split("\n") : []).filter(Boolean));
  const m = Bun.spawnSync([serverBin(env), "merge", task], { stdin: "ignore" });
  if (m.exitCode !== 0) return (m.stderr.toString() || m.stdout.toString()).trim() || "merge failed";
  const commit = tip(repo);
  // another task may have merged in between: keep only this task's own commits for an undo
  const all = git(repo, "rev-list", "--first-parent", `${base}..${commit}`).stdout.toString().trim().split("\n").filter(Boolean);
  const own = all.filter((c) => {
    const subject = git(repo, "log", "-1", "--format=%s", c).stdout.toString().trim();
    return subjects.has(subject) || subject.includes(task);
  });
  return own.length > 0 && own.length < all.length ? { base, commit, commits: own } : { base, commit };
}

/**
 * Applies a plan whose task has the branch the checks passed on: the rules and the readiness check have already said go.
 * Returns the recorded item, or why not.
 */
export function applyPlan(
  item: Omit<Item, "n" | "answer" | "answeredAt" | "auto">,
  repo: string,
  now: Date,
  env = process.env,
): { item: Item } | { error: string } {
  const merged = mergeTask(item.task, repo, env);
  if (typeof merged === "string") return { error: merged };
  return { item: recordApplied(item, merged.base, merged.commit, now, env, merged.commits) };
}

/** Undoes an applied change with a revert on the project's main. Returns an error line, or undefined when done. */
export function undoApplied(item: Item, now: Date, env = process.env): string | undefined {
  if (!item.auto || !item.base || !item.commit || !item.project) return "this item did not apply by itself, there is nothing to undo";
  if (item.undone) return "it was undone already";
  const settings = readSettings(item.project, env);
  if (typeof settings === "string") return settings;
  const repo = settings.repo;
  if (git(repo, "rev-parse", "--abbrev-ref", "HEAD").stdout.toString().trim() !== "main") return `${repo} is not on main, switch it to main and undo again`;
  if (git(repo, "status", "--porcelain", "--untracked-files=no").stdout.toString().trim() !== "")
    return `${repo} has uncommitted changes, commit or stash them and undo again`;
  const commits = item.commits ?? git(repo, "rev-list", "--first-parent", `${item.base}..${item.commit}`).stdout.toString().trim().split("\n").filter(Boolean);
  if (commits.length === 0) return "no commit of this change is on main";
  const before = tip(repo);
  for (const c of commits) {
    const parents = git(repo, "rev-list", "--parents", "-n", "1", c).stdout.toString().trim().split(" ").length - 1;
    const r = git(repo, "revert", "--no-edit", ...(parents > 1 ? ["-m", "1"] : []), c);
    if (r.exitCode !== 0) {
      git(repo, "revert", "--abort");
      git(repo, "reset", "-q", "--hard", before);
      return `the revert did not apply cleanly (${r.stderr.toString().trim().split("\n")[0]}), nothing changed`;
    }
  }
  if (git(repo, "remote", "get-url", "origin").exitCode === 0) {
    const p = git(repo, "push", "-q", "origin", "main");
    if (p.exitCode !== 0) {
      git(repo, "reset", "-q", "--hard", before);
      return `git push failed, nothing changed: ${p.stderr.toString().trim()}`;
    }
  }
  writeAtomic(itemFile(item.n, env), `${JSON.stringify({ ...item, undone: now.toISOString() }, null, 2)}\n`);
  return undefined;
}

const itemFile = (n: number, env = process.env) => join(configDir(env), "inbox", `${n}.json`);

/**
 * Plans that wait in the Inbox from before their project let them apply by themselves: the same checks, then the same
 * merge. A plan the checks refuse stays where it is, once per commit. Returns a line for each plan looked at.
 */
export function settlePlans(now: Date, env = process.env, only?: number): string[] {
  const out: string[] = [];
  const turn = { asked: false }; // the readiness model can take minutes: one plan a tick, so the rule loop is not held
  for (const item of readItems(env)) {
    if (item.kind !== "plan" || item.move || !isOpen(item) || !item.head || !item.diff || !plansAreAuto(item.project, env)) continue;
    if (only !== undefined && item.n !== only) continue;
    if (item.tried === item.head && only === undefined) continue;
    settleOne(item as Item & { head: string; diff: string }, now, env, turn, out);
  }
  return out;
}

/** One waiting plan: the checks, then the merge. Adds the line for it to `out`. */
function settleOne(item: Item & { head: string; diff: string }, now: Date, env: NodeJS.ProcessEnv, turn: { asked: boolean }, out: string[]): void {
  const settings = readSettings(item.project as string, env);
  if (typeof settings === "string") return;
  const repo = settings.repo;
  const tried = (why: string) => {
    writeAtomic(itemFile(item.n, env), `${JSON.stringify({ ...item, tried: item.head }, null, 2)}\n`);
    out.push(`inbox ${item.n}: ${item.task} stays: ${why}`);
  };
  const n = /-(\d+)$/.exec(item.task)?.[1];
  const branch = n && git(repo, "for-each-ref", "--format=%(objectname)", `refs/heads/work/${n}-*`).stdout.toString().trim();
  if (branch !== item.head) {
    closeItem(item, "the branch changed after the plan was sent", now, env);
    out.push(`inbox ${item.n}: closed, the branch changed after the plan was sent`);
    return;
  }
  const was = git(repo, "show", "main:docs/ROADMAP.md");
  const will = git(repo, "show", `${item.head}:docs/ROADMAP.md`);
  if (was.exitCode !== 0 || will.exitCode !== 0) {
    tried("the roadmap could not be read");
    return;
  }
  const problems = planProblems(was.stdout.toString(), will.stdout.toString());
  if (problems.length > 0) {
    tried(problems.join("; "));
    return;
  }
  if (turn.asked) return;
  turn.asked = true;
  const verdict = readiness(item.diff, item.project, env);
  if (!verdict.go) {
    tried(`the readiness check said no-go: ${verdict.why}`);
    return;
  }
  const merged = mergeTask(item.task, repo, env);
  if (typeof merged === "string") {
    tried(`the merge failed: ${merged}`);
    return;
  }
  writeAtomic(
    itemFile(item.n, env),
    `${JSON.stringify({ ...item, answer: "Approve", answeredAt: now.toISOString(), auto: true, base: merged.base, commit: merged.commit, ...(merged.commits ? { commits: merged.commits } : {}) }, null, 2)}\n`,
  );
  clearWait(item.task, env);
  out.push(`inbox ${item.n}: ${item.task} applied by itself under the rule`);
}

/** Reads a roadmap's text, for the callers that compare it with a changed one. */
