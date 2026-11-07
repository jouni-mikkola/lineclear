// Moving a task's branch onto its base: catching the base up, rebasing and merging on this machine.
import { join } from 'node:path'
import { branchExists, git, removeWorktree, type Run } from './git.ts'

/** bring the local base up to the remote's when there is one; refused when the two have split */
export async function catchUp(repo: string, base: string): Promise<Run> {
  const ok: Run = { ok: true, code: 0, out: '', err: '' }
  if (!(await git(repo, 'remote', 'get-url', 'origin')).ok) return ok
  // offline: go on with what is here
  if (!(await git(repo, 'fetch', '--quiet', 'origin', base)).ok) return ok
  const remote = `origin/${base}`
  if (!(await git(repo, 'rev-parse', '--verify', '--quiet', remote)).ok) return ok
  if (!(await branchExists(repo, base))) return git(repo, 'branch', '--', base, remote)
  if ((await git(repo, 'merge-base', '--is-ancestor', remote, base)).ok) return ok
  if (!(await git(repo, 'merge-base', '--is-ancestor', base, remote)).ok)
    return { ...ok, ok: false, err: `${base} here and ${remote} have split; bring them together first` }
  const r =
    (await git(repo, 'branch', '--show-current')).out === base
      ? await git(repo, 'merge', '--ff-only', '--quiet', remote)
      : await git(repo, 'update-ref', `refs/heads/${base}`, remote)
  return r.ok ? r : { ...r, err: `could not bring ${base} up to ${remote}: ${(r.err || r.out).split('\n')[0]}` }
}

/** replay the branch on top of the base; a conflict leaves it as it was */
export async function rebase(wt: string, base: string) {
  const r = await git(wt, 'rebase', base)
  if (!r.ok) await git(wt, 'rebase', '--abort')
  return r
}

/** merge a commit (or branch) into the base on this machine, without disturbing the checkout you work in */
export async function mergeHere(repo: string, branch: string, base: string, message: string, squash: boolean): Promise<Run> {
  const current = (await git(repo, 'branch', '--show-current')).out
  if (current === base) {
    if ((await git(repo, 'status', '--porcelain', '--untracked-files=no')).out.trim())
      return { ok: false, code: 1, out: '', err: `${base} has uncommitted changes in ${repo}` }
    const m = squash ? await git(repo, 'merge', '--squash', branch) : await git(repo, 'merge', '--no-ff', '-m', message, branch)
    if (!m.ok) {
      await git(repo, 'merge', '--abort')
      await git(repo, 'reset', '--hard', 'HEAD')
      return { ...m, err: `conflict: ${m.out || m.err}` }
    }
    return squash ? git(repo, 'commit', '-q', '-m', message) : m
  }
  // base is not checked out here: merge in a scratch worktree, then move the branch
  const tmp = join(repo, '.git', `lineclear-merge-${Date.now()}`)
  const add = await git(repo, 'worktree', 'add', '--detach', tmp, base)
  if (!add.ok) return add
  try {
    const m = squash ? await git(tmp, 'merge', '--squash', branch) : await git(tmp, 'merge', '--no-ff', '-m', message, branch)
    if (!m.ok) return { ...m, err: `conflict: ${m.out || m.err}` }
    if (squash) {
      const c = await git(tmp, 'commit', '-q', '-m', message)
      if (!c.ok) return c
    }
    const head = (await git(tmp, 'rev-parse', 'HEAD')).out
    return git(repo, 'update-ref', `refs/heads/${base}`, head)
  } finally {
    await removeWorktree(repo, tmp, true)
  }
}
