// git for tasks: what a fresh worktree starts from and gets copied in, whether its work is in main, commits, rebasing
// on main and merging into it. herdr itself makes and removes task worktrees (worktrees.ts).
import { join } from 'node:path'
import { remoteBox, GIT_READ_SHARE_MS, isGitRead, run } from '../box.ts'
import { existsSync } from '../mfs.ts'

export interface Run {
  ok: boolean
  code: number
  out: string
  err: string
}

/** a command on the task's machine: here, or over SSH on another one (box.ts) */
export async function sh(
  cmd: string[],
  cwd: string,
  opts: { timeoutMs?: number; env?: Record<string, string>; here?: boolean; onPid?: (pid: number) => void } = {},
): Promise<Run> {
  if (!remoteBox() && !existsSync(cwd)) return { ok: false, code: 127, out: '', err: `the folder ${cwd} is gone` } // else Bun says "posix_spawn 'git'"
  const share = isGitRead(cmd) // asked before the broker's flags go in front of the subcommand
  if (remoteBox() && !opts.here) {
    const r = await run(cmd, { cwd, env: { GIT_TERMINAL_PROMPT: '0', ...opts.env }, timeoutMs: opts.timeoutMs, shareMs: share ? GIT_READ_SHARE_MS : undefined })
    return { ok: r.code === 0, code: r.code, out: r.out.trimEnd(), err: r.err.trimEnd() }
  }
  const p = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env } })
  opts.onPid?.(p.pid)
  let timedOut = false
  const t = opts.timeoutMs ? setTimeout(() => ((timedOut = true), p.kill()), opts.timeoutMs) : null
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  if (t) clearTimeout(t)
  return { ok: code === 0 && !timedOut, code: timedOut ? 124 : code, out: out.trimEnd(), err: timedOut ? `${err}\ntimed out` : err.trimEnd() }
}

export const git = (cwd: string, ...args: string[]) => sh(['git', ...args], cwd)

export const isRepo = async (path: string) => (await git(path, 'rev-parse', '--show-toplevel')).ok

export async function topLevel(path: string) {
  const r = await git(path, 'rev-parse', '--show-toplevel')
  return r.ok ? r.out : null
}

export async function defaultBranch(repo: string) {
  const r = await git(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
  if (r.ok) return r.out.replace(/^origin\//, '')
  for (const b of ['main', 'master']) if ((await git(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${b}`)).ok) return b
  return (await git(repo, 'branch', '--show-current')).out || 'main'
}

export function slug(title: string, max = 30) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || 'task'
  )
}

export async function branchExists(repo: string, branch: string) {
  return (await git(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`)).ok
}

/** the linked worktree `branch` is checked out in, if any (never the repo's own checkout, listed first) */
export async function worktreeOf(repo: string, branch: string) {
  const r = await git(repo, 'worktree', 'list', '--porcelain')
  const entry = r.out
    .split('\n\n')
    .slice(1)
    .find((e) => e.split('\n').includes(`branch refs/heads/${branch}`))
  return entry
    ?.split('\n')
    .find((l) => l.startsWith('worktree '))
    ?.slice('worktree '.length)
}

/** files changed or new in the checkout (ignored ones don't count) */
export async function dirty(wt: string) {
  const r = await git(wt, 'status', '--porcelain')
  return !r.ok || !!r.out.trim()
}

export async function removeWorktree(repo: string, path: string, force = false) {
  const r = await git(repo, 'worktree', 'remove', ...(force ? ['--force'] : []), path)
  await git(repo, 'worktree', 'prune')
  return r
}

/** commit whatever the agent left uncommitted */
export async function commitAll(wt: string, message: string) {
  const st = await git(wt, 'status', '--porcelain')
  if (!st.out.trim()) return false
  await git(wt, 'add', '-A')
  const r = await sh(['git', '-c', 'user.useConfigOnly=false', 'commit', '-q', '-m', message], wt)
  return r.ok
}

/** the files where the branch's own changes leave a conflict marker (<<<<<<<, =======, >>>>>>>): a half-solved conflict
 *  that was committed. git diff --check names them by line. */
export async function conflictMarkers(wt: string, base: string) {
  const r = await git(wt, 'diff', '--check', await mergeBase(wt, base), 'HEAD')
  const flagged = [...new Set(r.out.split('\n').flatMap((l) => /^(.*):\d+: leftover conflict marker/.exec(l)?.[1] ?? []))]
  if (!flagged.length) return []
  // a line of seven = alone is also a Markdown heading underline: only a file with <<<<<<< or >>>>>>> counts
  const g = await git(wt, 'grep', '-lE', '^(<<<<<<<|>>>>>>>)( |$)', 'HEAD', '--', ...flagged)
  const files = g.out
    .split('\n')
    .map((l) => l.replace(/^HEAD:/, ''))
    .filter((f) => flagged.includes(f))
  return [...new Set(files)]
}

export async function mergeBase(wt: string, base: string) {
  const ref = (await git(wt, 'rev-parse', '--verify', '--quiet', `origin/${base}`)).ok ? `origin/${base}` : base
  const r = await git(wt, 'merge-base', ref, 'HEAD')
  return r.ok ? r.out : ref
}

/** commits were made on `branch` since it was made: its tip is no longer the commit its reflog starts at */
export async function workedOn(wt: string, branch: string) {
  const r = await git(wt, 'reflog', 'show', '--format=%H', `refs/heads/${branch}`)
  const first = r.out.split('\n').filter(Boolean).at(-1)
  const head = await git(wt, 'rev-parse', 'HEAD')
  return r.ok && !!first && head.ok && head.out !== first
}

export async function aheadCount(wt: string, base: string) {
  const mb = await mergeBase(wt, base)
  const r = await git(wt, 'rev-list', '--count', `${mb}..HEAD`)
  return Number(r.out || 0)
}

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
  const mergeCmd = (cwd: string) => (squash ? git(cwd, 'merge', '--squash', branch) : git(cwd, 'merge', '--no-ff', '-m', message, branch))
  if ((await git(repo, 'branch', '--show-current')).out === base) {
    if ((await git(repo, 'status', '--porcelain', '--untracked-files=no')).out.trim())
      return { ok: false, code: 1, out: '', err: `${base} has uncommitted changes in ${repo}` }
    const m = await mergeCmd(repo)
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
    const m = await mergeCmd(tmp)
    if (!m.ok) return { ...m, err: `conflict: ${m.out || m.err}` }
    const c = squash ? await git(tmp, 'commit', '-q', '-m', message) : m
    return c.ok ? git(repo, 'update-ref', `refs/heads/${base}`, (await git(tmp, 'rev-parse', 'HEAD')).out) : c
  } finally {
    await removeWorktree(repo, tmp, true)
  }
}
