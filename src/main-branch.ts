import { gitText } from "./git.ts";
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

/** The first ref of main that exists, or undefined when the repo has none. */
export function mainRef(repo: string): string | undefined {
  return mainRefs(repo).find((r) => exists(repo, r));
}
