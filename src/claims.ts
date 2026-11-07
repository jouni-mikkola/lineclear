// A step is claimed once per GitHub repo, not once per space: each machine names its space for a repo as it likes, so
// only the repo's own refs are the same everywhere. The claim is the ref `refs/lineclear/claims/<step>` on origin.
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { World } from "./world.ts";

const CLAIM_PREFIX = "refs/lineclear/claims/";

type Run = (cmd: string[]) => { code: number; out: string; err: string };

const gitIn = (run: Run, repo: string, ...args: string[]) => run(["git", "-C", repo, ...args]);

/** True when the repo has an origin to share claims through. A repo with none has nobody to race. */
const hasOrigin = (run: Run, repo: string) => gitIn(run, repo, "remote", "get-url", "origin").code === 0;

/** The claim operations of the world, on top of one way to run a command. */
export function claimWorld(run: Run, originMain: (repo: string) => string): Pick<World, "claimStep" | "claimedSteps" | "releaseStep"> {
  return {
    claimStep(repo, step) {
      if (!hasOrigin(run, repo)) return undefined;
      const ref = `${CLAIM_PREFIX}${step}`;
      // Every claim is a commit of its own: pushing the value a ref already has would count as a success.
      const made = gitIn(
        run,
        repo,
        "-c",
        "user.name=lineclear",
        "-c",
        "user.email=lineclear@localhost",
        "commit-tree",
        `${originMain(repo)}^{tree}`,
        "-m",
        `claim ${step} ${hostname()} ${randomUUID()}`,
      );
      if (made.code !== 0) return (made.err || made.out).trim().split("\n")[0] || `commit-tree exit ${made.code}`;
      // `--force-with-lease=<ref>:` with an empty expected value fails when the ref exists: only one push wins.
      const push = gitIn(run, repo, "push", "--quiet", `--force-with-lease=${ref}:`, "origin", `${made.out.trim()}:${ref}`);
      if (push.code === 0) return undefined;
      const there = gitIn(run, repo, "ls-remote", "origin", ref);
      if (there.code === 0 && there.out.trim() !== "") return "held";
      return (push.err || push.out).trim().split("\n")[0] || `push exit ${push.code}`;
    },
    claimedSteps(repo) {
      if (!hasOrigin(run, repo)) return [];
      const r = gitIn(run, repo, "ls-remote", "origin", `${CLAIM_PREFIX}*`);
      if (r.code !== 0) return [];
      return r.out
        .split("\n")
        .map((l) => l.split("\t")[1]?.trim() ?? "")
        .filter((ref) => ref.startsWith(CLAIM_PREFIX))
        .map((ref) => ref.slice(CLAIM_PREFIX.length));
    },
    releaseStep(repo, step) {
      if (!hasOrigin(run, repo)) return;
      gitIn(run, repo, "push", "--quiet", "origin", `:${CLAIM_PREFIX}${step}`);
    },
  };
}
