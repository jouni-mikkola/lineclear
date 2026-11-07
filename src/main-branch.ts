import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, gitFailure, gitText } from "./git.ts";
// Which branch is a repo's main. New repos call it main, many older ones master; origin/HEAD names it when a clone set it.

const exists = (repo: string, ref: string) => gitText(repo, "rev-parse", "--verify", "-q", ref) !== undefined;

/** The name of the repo's main branch: what origin/HEAD points at, else main or master, whichever exists; main when neither. */
export function mainBranch(repo: string): string {
  const head = gitText(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD");
  if (head?.startsWith("origin/")) return head.slice("origin/".length);
  return ["main", "master"].find((b) => exists(repo, `origin/${b}`) || exists(repo, b)) ?? "main";
}

/** The refs of main to read, best first: origin's copy, then the local branch. */
export function mainRefs(repo: string): [string, string] {
  const b = mainBranch(repo);
  return [`origin/${b}`, b];
}

/** Reverts a commit on origin's main and pushes the revert, as a plain push. Returns an error text, or undefined. */
export function revertOnMain(repo: string, commit: string): string | undefined {
  // In a folder of its own, from exactly this commit: a main that moved meanwhile makes the push fail, never overwrites.
  const dir = mkdtempSync(join(tmpdir(), "lineclear-revert-"));
  try {
    const added = git(repo, "worktree", "add", "--detach", dir, commit);
    if (!added.ok) return gitFailure(added);
    const parents = git(dir, "rev-list", "--parents", "-n", "1", commit).out.trim().split(/\s+/).length - 1;
    const reverted = git(dir, "revert", "--no-edit", ...(parents > 1 ? ["-m", "1"] : []), commit);
    if (!reverted.ok) {
      git(dir, "revert", "--abort");
      return gitFailure(reverted);
    }
    return gitFailure(git(dir, "push", "origin", "HEAD:main"));
  } finally {
    git(repo, "worktree", "remove", "--force", dir);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The first ref of main that exists, or undefined when the repo has none. */
export function mainRef(repo: string): string | undefined {
  return mainRefs(repo).find((r) => exists(repo, r));
}
