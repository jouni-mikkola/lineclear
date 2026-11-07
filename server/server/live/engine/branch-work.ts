// What a task's branch holds apart from its base: what "nothing to merge" must never hide, and what a new machine starts from.
import * as G from './git.ts'
import { landed, squashesOf } from './landed.ts'

/** the branch's commits not in the base by content (`git cherry`), against the remote's base when there is one; none when the branch is gone or all of it landed (a squash merge counts) */
export async function unmerged(repo: string, branch: string, base: string, id: string): Promise<number> {
  if (!(await G.branchExists(repo, branch))) return 0
  const upstream = (await G.git(repo, 'rev-parse', '--verify', '--quiet', `origin/${base}`)).ok ? `origin/${base}` : base
  const r = await G.git(repo, 'cherry', upstream, branch)
  const left = r.ok ? r.out.split('\n').filter((l) => l.startsWith('+')).length : 0
  return left && (await landed(repo, branch, upstream, await squashesOf(repo, upstream, id))) ? 0 : left
}

/** the commit of `branch` on origin when this machine has no such branch (it was pushed from another one), so a worktree made for it starts from that work, not from the base */
export async function remoteBranch(repo: string, branch: string): Promise<string | undefined> {
  if (await G.branchExists(repo, branch)) return undefined
  if (!(await G.sh(['git', 'fetch', '--quiet', 'origin', branch], repo, { timeoutMs: 15_000 })).ok) return undefined
  const r = await G.git(repo, 'rev-parse', '--verify', '--quiet', 'FETCH_HEAD^{commit}')
  return r.ok ? r.out : undefined
}
