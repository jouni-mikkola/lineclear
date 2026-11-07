// git for tasks: whether a branch's work is in main, commits and the refs between a task's branch and its base.
// herdr itself makes and removes task worktrees (worktrees.ts).
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

/** merging `ref` into commit `into` makes exactly commit `is`'s tree */
async function mergesTo(repo: string, into: string, ref: string, is: string) {
  const m = await git(repo, 'merge-tree', '--write-tree', into, ref)
  const b = await git(repo, 'rev-parse', `${is}^{tree}`)
  return m.ok && b.ok && m.out.split('\n')[0] === b.out
}

/** merging `ref` into `base` goes through without a conflict: what GitHub calls mergeable */
export const mergesCleanly = async (repo: string, base: string, ref: string) => (await git(repo, 'merge-tree', '--write-tree', base, ref)).ok

/** the commits on `base` a task's squash merge made: by Lineclear's subject, "<id>: <title>" */
export async function squashesOf(repo: string, base: string, id: string) {
  const r = await git(repo, 'log', '--format=%H %s', '-n', '5000', base)
  return r.ok
    ? r.out
        .split('\n')
        .filter((l) => l.slice(41).startsWith(`${id}: `))
        .map((l) => l.slice(0, 40))
    : []
}

/**
 * Everything on `ref` is in `base` already: its exact tree is one `base` had (a squash merge of the rebased branch
 * makes that commit; a branch with no work has its starting point's), squash-merging it now onto the parent of one of
 * `squashes` (its task's squash merges into `base`) makes that very commit, so nothing came after the merge (not even
 * a commit undoing part of it), however main has moved on since, or merging it into `base` would change nothing.
 */
export async function landed(repo: string, ref: string, base: string, squashes: string[] = []) {
  const tree = await git(repo, 'rev-parse', '--verify', '--quiet', `${ref}^{tree}`)
  if (!tree.ok) return false
  const trees = await git(repo, 'log', '--format=%T', '-n', '5000', base)
  if (trees.ok && trees.out.split('\n').includes(tree.out)) return true
  for (const s of squashes) {
    if (!(await git(repo, 'merge-base', '--is-ancestor', s, base)).ok) continue
    if (await mergesTo(repo, `${s}^`, ref, s)) return true
  }
  return mergesTo(repo, base, ref, base)
}

export async function removeWorktree(repo: string, path: string, force = false) {
  const r = force ? await git(repo, 'worktree', 'remove', '--force', path) : await git(repo, 'worktree', 'remove', path)
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
