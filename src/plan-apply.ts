import { gitAsLineclear, gitFailure } from "./git.ts";
import { addItem, saveItem, type Item } from "./inbox.ts";
import { serverBin } from "./paths.ts";
import { readSettings } from "./project.ts";

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
const isPlanId = (task: string) => task.startsWith("PLAN-");

/** The branch refs of a plan's task: `plan/PLAN-n` for the Dispatcher's own plan, else the task's `work/<n>-*`. */
function planRef(task: string): string | undefined {
  if (isPlanId(task)) return `refs/heads/plan/${task}`;
  const n = /-(\d+)$/.exec(task)?.[1];
  return n ? `refs/heads/work/${n}-*` : undefined;
}

function serverMerge(task: string, env: NodeJS.ProcessEnv): string | undefined {
  const m = Bun.spawnSync([serverBin(env), "merge", task], { stdin: "ignore" });
  return m.exitCode === 0 ? undefined : (m.stderr.toString() || m.stdout.toString()).trim() || "merge failed";
}

/** Merges a Dispatcher plan's branch into main with git. Only when main is checked out and clean, and a conflict is undone. */
function mergePlanBranch(task: string, repo: string): string | undefined {
  if (gitAsLineclear(repo, "rev-parse", "--abbrev-ref", "HEAD").out.trim() !== "main" || gitAsLineclear(repo, "status", "--porcelain").out.trim() !== "")
    return "main is not checked out clean in the project folder, so the plan was not merged";
  const m = gitAsLineclear(repo, "merge", "--no-ff", "--no-edit", "-m", `${task}: roadmap plan`, `plan/${task}`);
  if (!m.ok) gitAsLineclear(repo, "merge", "--abort");
  return gitFailure(m);
}

/** Merges a plan's task by the server, or a Dispatcher plan's branch by git. Returns the main commits it added, or an error line. */
function mergeTask(task: string, repo: string, env = process.env): { base: string; commit: string; commits?: string[] } | string {
  const base = tip(repo);
  const ref = planRef(task);
  const subjects = new Set((ref ? gitAsLineclear(repo, "log", "--format=%s", `main..${ref}`).out.trim().split("\n") : []).filter(Boolean));
  const failure = isPlanId(task) ? mergePlanBranch(task, repo) : serverMerge(task, env);
  if (failure !== undefined) return failure;
  // another task may have merged in between: keep only this task's own commits for an undo
  const log = gitAsLineclear(repo, "log", "--first-parent", "--format=%H%x09%s", `${base}..HEAD`).out.trim().split("\n").filter(Boolean);
  const all = log.map((l) => ({ hash: l.slice(0, l.indexOf("\t")), subject: l.slice(l.indexOf("\t") + 1) }));
  const commit = all[0]?.hash ?? base;
  const own = all.filter((c) => subjects.has(c.subject) || c.subject.includes(task)).map((c) => c.hash);
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
