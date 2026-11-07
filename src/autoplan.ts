import { askModel } from "./ask-model.ts";
import { ownerDirection } from "./direction.ts";
import { askBefore, readSettings } from "./project.ts";
import { checkRoadmap, parseRoadmap, resultOf, stepResultProblems, type Step } from "./roadmap.ts";
import { stepLocks } from "./parts.ts";

const lines = (s: Step, field: string) => {
  const f = s.fields[field];
  return f ? [f.value, ...f.more].map((l) => l.trim().replace(/^[-*]\s+/, "")).filter(Boolean) : [];
};
const lockSet = (s: Step) => new Set(stepLocks(s).map((l) => l.toLowerCase()));

/** The step the longest chain is counted to: the last step that is not dropped. */
function lastStep(steps: Step[]): string | undefined {
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
