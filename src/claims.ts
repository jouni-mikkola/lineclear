// A step is claimed once per GitHub repo, not once per space: each machine names its space for a repo as it likes, so
// only the repo's own refs are the same everywhere. The claim is the ref `refs/lineclear/claims/<step>` on GitHub, made
// through its REST API: creating a ref that exists fails, so only one loop wins, and no git push (no hook, no pack
// write) is involved.
import type { Cmd, Ran } from "./run-all.ts";
import type { World } from "./world.ts";

const CLAIM_PREFIX = "refs/lineclear/claims/";
const API_TIMEOUT_MS = 30_000;

type Run = (cmd: string[]) => Ran;
type RunAll = (cmds: Cmd[]) => Ran[];

const gitIn = (run: Run, repo: string, ...args: string[]) => run(["git", "-C", repo, ...args]);
const firstLine = (r: Ran) => (r.err || r.out).trim().split("\n")[0] || `exit ${r.code}`;

/** `owner/name` of the repo's origin on GitHub, or undefined when it has none there: nobody to race. */
function githubRepo(run: Run, repo: string): string | undefined {
  const r = gitIn(run, repo, "remote", "get-url", "origin");
  const m = r.code === 0 ? /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(r.out.trim()) : null;
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/** The claim operations of the world, on top of ways to run one command and many at once. */
export function claimWorld(run: Run, runAll: RunAll, originMain: (repo: string) => string): Pick<World, "claimSteps" | "claimedSteps" | "releaseSteps"> {
  return {
    claimSteps(repo, steps) {
      const gh = githubRepo(run, repo);
      if (gh === undefined || steps.length === 0) return steps.map(() => undefined);
      // The ref must point at a commit GitHub has: origin/main's head.
      const head = gitIn(run, repo, "rev-parse", originMain(repo));
      if (head.code !== 0) return steps.map(() => `origin/main cannot be read: ${firstLine(head)}`);
      const sha = head.out.trim();
      const cmds = steps.map((step) => ({
        argv: ["gh", "api", "--method", "POST", `repos/${gh}/git/refs`, "-f", `ref=${CLAIM_PREFIX}${step}`, "-f", `sha=${sha}`, "--silent"],
        timeoutMs: API_TIMEOUT_MS,
      }));
      return runAll(cmds).map((r) => (r.code === 0 ? undefined : /Reference already exists/i.test(r.out + r.err) ? "held" : firstLine(r)));
    },
    claimedSteps(repo) {
      const gh = githubRepo(run, repo);
      if (gh === undefined) return [];
      const r = run(["gh", "api", "--paginate", `repos/${gh}/git/matching-refs/${CLAIM_PREFIX.slice("refs/".length)}`, "--jq", ".[].ref"]);
      if (r.code !== 0) return [];
      return r.out
        .split("\n")
        .map((ref) => ref.trim())
        .filter((ref) => ref.startsWith(CLAIM_PREFIX))
        .map((ref) => ref.slice(CLAIM_PREFIX.length));
    },
    releaseSteps(repo, steps) {
      const gh = githubRepo(run, repo);
      if (gh === undefined || steps.length === 0) return;
      runAll(
        steps.map((step) => ({ argv: ["gh", "api", "--method", "DELETE", `repos/${gh}/git/${CLAIM_PREFIX}${step}`, "--silent"], timeoutMs: API_TIMEOUT_MS })),
      );
    },
  };
}
