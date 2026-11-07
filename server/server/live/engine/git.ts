// git for tasks: what a fresh worktree starts from and gets copied in, whether its work is in main, commits, rebasing
// on main and merging into it. herdr itself makes and removes task worktrees (worktrees.ts).
import { AsyncLocalStorage } from 'node:async_hooks'
import { join } from 'node:path'
import { remoteBox, run } from '../box.ts'
import { exists } from '../mfs.ts'

/** the signal of the merge a step belongs to: once aborted, the step's process group ends */
export const stepSignal = new AsyncLocalStorage<AbortSignal>()

/** how long one git step may run before its process group is ended */
const STEP_TIMEOUT_MS = 10 * 60_000

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
  if (!remoteBox() && !(await exists(cwd))) return { ok: false, code: 127, out: '', err: `the folder ${cwd} is gone` } // else Bun says "posix_spawn 'git'"
  if (remoteBox() && !opts.here) {
    const r = await run(cmd, { cwd, env: { GIT_TERMINAL_PROMPT: '0', ...opts.env }, timeoutMs: opts.timeoutMs })
    return { ok: r.code === 0, code: r.code, out: r.out.trimEnd(), err: r.err.trimEnd() }
  }
  const p = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe', detached: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env } })
  opts.onPid?.(p.pid)
  let timedOut = false
  // its own group, so what it started ends with it
  const end = () => {
    try {
      process.kill(-p.pid, 'SIGKILL')
    } catch {
      p.kill('SIGKILL')
    }
  }
  const timer = setTimeout(() => ((timedOut = true), end()), opts.timeoutMs ?? STEP_TIMEOUT_MS)
  const signal = stepSignal.getStore()
  if (signal?.aborted) end()
  signal?.addEventListener('abort', end, { once: true })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  clearTimeout(timer)
  signal?.removeEventListener('abort', end)
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

/** the files the branch changed that hold a conflict marker (<<<<<<< or >>>>>>>): a half-solved conflict that was
 *  committed. A line of seven = alone is also a Markdown heading underline, so it doesn't count. Both git calls
 *  answer in null-separated paths and an exit code, so no locale changes the result. */
export async function conflictMarkers(wt: string, base: string) {
  const changed = await git(wt, 'diff', '--name-only', '--diff-filter=AMCR', '-z', await mergeBase(wt, base), 'HEAD')
  const paths = changed.out.split('\0').filter(Boolean)
  if (!changed.ok || !paths.length) return []
  const g = await git(wt, 'grep', '-lzE', '-e', '^(<<<<<<<|>>>>>>>)( |$)', 'HEAD', '--', ...paths)
  return g.code === 0
    ? g.out
        .split('\0')
        .filter(Boolean)
        .map((f) => f.slice('HEAD:'.length))
    : []
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
