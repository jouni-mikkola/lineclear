import { planProblems, plansAreAuto, readiness } from "./autoplan.ts";
import { gitAsLineclear, gitFailure } from "./git.ts";
import { addItem, closeItem, isOpen, readItems, saveItem, type Item } from "./inbox.ts";
import { serverBin } from "./paths.ts";
import { readSettings } from "./project.ts";
import { clearWait } from "./waits.ts";

const tip = (repo: string) => gitAsLineclear(repo, "rev-parse", "HEAD").out.trim();

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

/** A plan the Dispatcher wrote itself has an id `PLAN-n` and no task: its branch is `plan/PLAN-n`. */
export const isPlanId = (task: string) => task.startsWith("PLAN-");

/** The branch refs of a plan's task: `plan/PLAN-n` for the Dispatcher's own plan, else the task's `work/<n>-*`. */
export function planRef(task: string): string | undefined {
  if (isPlanId(task)) return `refs/heads/plan/${task}`;
  const n = /-(\d+)$/.exec(task)?.[1];
  return n ? `refs/heads/work/${n}-*` : undefined;
}

function serverMerge(task: string, env: NodeJS.ProcessEnv): string | undefined {
  const m = Bun.spawnSync([serverBin(env), "merge", task], { stdin: "ignore" });
  return m.exitCode === 0 ? undefined : (m.stderr.toString() || m.stdout.toString()).trim() || "merge failed";
}

/** Merges a plan's task by the server, or a Dispatcher plan's branch by git. Returns the main commits it added, or an error line. */
export function mergeTask(task: string, repo: string, env = process.env): { base: string; commit: string; commits?: string[] } | string {
  const base = tip(repo);
  const ref = planRef(task);
  const subjects = new Set((ref ? gitAsLineclear(repo, "log", "--format=%s", `main..${ref}`).out.trim().split("\n") : []).filter(Boolean));
  const failure = isPlanId(task)
    ? gitFailure(gitAsLineclear(repo, "merge", "--no-ff", "--no-edit", "-m", `${task}: roadmap plan`, `plan/${task}`))
    : serverMerge(task, env);
  if (failure !== undefined) return failure;
  const commit = tip(repo);
  // another task may have merged in between: keep only this task's own commits for an undo
  const all = gitAsLineclear(repo, "rev-list", "--first-parent", `${base}..${commit}`).out.trim().split("\n").filter(Boolean);
  const own = all.filter((c) => {
    const subject = gitAsLineclear(repo, "log", "-1", "--format=%s", c).out.trim();
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
  if (gitAsLineclear(repo, "rev-parse", "--abbrev-ref", "HEAD").out.trim() !== "main") return `${repo} is not on main, switch it to main and undo again`;
  if (gitAsLineclear(repo, "status", "--porcelain", "--untracked-files=no").out.trim() !== "")
    return `${repo} has uncommitted changes, commit or stash them and undo again`;
  const commits = item.commits ?? gitAsLineclear(repo, "rev-list", "--first-parent", `${item.base}..${item.commit}`).out.trim().split("\n").filter(Boolean);
  if (commits.length === 0) return "no commit of this change is on main";
  const before = tip(repo);
  for (const c of commits) {
    const parents = gitAsLineclear(repo, "rev-list", "--parents", "-n", "1", c).out.trim().split(" ").length - 1;
    const r = gitAsLineclear(repo, "revert", "--no-edit", ...(parents > 1 ? ["-m", "1"] : []), c);
    if (!r.ok) {
      gitAsLineclear(repo, "revert", "--abort");
      gitAsLineclear(repo, "reset", "-q", "--hard", before);
      return `the revert did not apply cleanly (${r.err.split("\n")[0]}), nothing changed`;
    }
  }
  if (gitAsLineclear(repo, "remote", "get-url", "origin").ok) {
    const p = gitAsLineclear(repo, "push", "-q", "origin", "main");
    if (!p.ok) {
      gitAsLineclear(repo, "reset", "-q", "--hard", before);
      return `git push failed, nothing changed: ${p.err}`;
    }
  }
  saveItem({ ...item, undone: now.toISOString() }, env);
  return undefined;
}

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
    saveItem({ ...item, tried: item.head }, env);
    out.push(`inbox ${item.n}: ${item.task} stays: ${why}`);
  };
  const ref = planRef(item.task);
  const branch = ref && gitAsLineclear(repo, "for-each-ref", "--format=%(objectname)", ref).out.trim();
  if (branch !== item.head) {
    closeItem(item, "the branch changed after the plan was sent", now, env);
    out.push(`inbox ${item.n}: closed, the branch changed after the plan was sent`);
    return;
  }
  const was = gitAsLineclear(repo, "show", "main:docs/ROADMAP.md");
  const will = gitAsLineclear(repo, "show", `${item.head}:docs/ROADMAP.md`);
  if (!was.ok || !will.ok) {
    tried("the roadmap could not be read");
    return;
  }
  const problems = planProblems(was.out, will.out);
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
  saveItem(
    {
      ...item,
      answer: "Approve",
      answeredAt: now.toISOString(),
      auto: true,
      base: merged.base,
      commit: merged.commit,
      ...(merged.commits ? { commits: merged.commits } : {}),
    },
    env,
  );
  clearWait(item.task, env);
  out.push(`inbox ${item.n}: ${item.task} applied by itself under the rule`);
}
