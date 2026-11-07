// Where a task's branch starts from: the repo's base branch, checked and brought up to date first.
import { branchExists, git, sh } from './git.ts'
import { gh, github } from './github.ts'

/** Check a named destination before a task gets a worktree. Never change origin/HEAD. */
export async function validateBase(repo: string, base: string) {
  if (!base || base.startsWith('-') || !(await git(repo, 'check-ref-format', `refs/heads/${base}`)).ok)
    throw new Error('Choose a branch name, like main, develop or feature/login.')
  const common = await git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  if (!common.ok || !(await sh(['test', '-w', common.out], repo)).ok) throw new Error('No permission to write to this repository.')
  const remote = (await git(repo, 'remote', 'get-url', 'origin')).ok
  if (remote) {
    const fetched = await git(repo, 'fetch', '--quiet', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`)
    if (!fetched.ok) throw new Error(`Cannot fetch branch ${base} from origin: ${(fetched.err || fetched.out).split('\n')[0]}`)
    const g = await github(repo)
    if (g) {
      const r = await gh(g, repo, 'repo', 'view', `${g.host}/${g.repo}`, '--json', 'viewerPermission', '--jq', '.viewerPermission')
      if (!r.ok || !['WRITE', 'MAINTAIN', 'ADMIN'].includes(r.out.trim()))
        throw new Error(`Cannot confirm permission to merge into ${base} on GitHub. Sign in with repository write access first.`)
    } else {
      const r = await git(repo, 'push', '--dry-run', 'origin', `refs/remotes/origin/${base}:refs/heads/${base}`)
      if (!r.ok) throw new Error(`Cannot confirm permission to push ${base} to origin: ${(r.err || r.out).split('\n')[0]}`)
    }
  } else if (!(await branchExists(repo, base))) throw new Error(`No local branch ${base}.`)
}

/** the commit a task's branch starts from: the remote's base when there is one (fetched first), else the local one.
 *  A commit, not a remote-tracking ref, so no upstream is written into the repo's shared config. */
export async function startPoint(repo: string, base: string) {
  await validateBase(repo, base)
  const from = (await git(repo, 'rev-parse', '--verify', '--quiet', `origin/${base}`)).ok ? `origin/${base}` : base
  if (!(await branchExists(repo, base)) && from !== base) {
    const made = await git(repo, 'branch', '--', base, from)
    if (!made.ok) throw new Error(`Cannot create local branch ${base}: ${made.err}`)
  }
  const r = await git(repo, 'rev-parse', '--verify', '--quiet', `${from}^{commit}`)
  return r.ok ? r.out : from
}
