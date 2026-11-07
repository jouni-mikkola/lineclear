// git for tasks: what a fresh worktree starts from and gets copied in, whether its work is in main, commits, rebasing
// on main and merging into it. herdr itself makes and removes task worktrees (worktrees.ts).
import { basename, join } from 'node:path'
import { remoteBox, GIT_READ_SHARE_MS, isGitRead, run } from '../box.ts'
import { cpSync, existsSync, readdirSync, readFileSync } from '../mfs.ts'

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

/** a GitHub repo as gh reaches it: owner/name, and the host gh is logged in to for it (github.com, github.localhost) */
export interface GitHub {
  repo: string
  host: string
}

/** host and owner/name of a remote URL in any form git takes: https://host/o/r(.git), ssh://git@host/o/r, git@host:o/r */
function parseRemote(url: string): GitHub | null {
  const m = url.trim().match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/i)
  return m && /github/i.test(m[1]) ? { host: m[1].toLowerCase(), repo: m[2] } : null
}

/**
 * The repo's GitHub remote, read live (a repo may gain one after it was added): origin as written, and as git rewrites
 * it (url.insteadOf), so github.com mapped to github.localhost is found either way. gh talks to the host git really
 * reaches when that is a GitHub one, else to the one written.
 */
export async function github(repo: string): Promise<GitHub | null> {
  return (await githubs(repo))[0] ?? null
}

/** each GitHub repo origin may be: as git rewrites it first, then as written */
export async function githubs(repo: string): Promise<GitHub[]> {
  const [written, used] = await Promise.all([git(repo, 'config', '--get', 'remote.origin.url'), git(repo, 'remote', 'get-url', 'origin')])
  const all = [used.ok ? parseRemote(used.out) : null, written.ok ? parseRemote(written.out) : null].filter((g): g is GitHub => !!g)
  return all.filter((g, i) => all.findIndex((x) => x.host === g.host && x.repo === g.repo) === i)
}

export async function githubRemote(repo: string): Promise<string | null> {
  return (await github(repo))?.repo ?? null
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

/** git's own pattern match is not needed here: `*` matches anything, and a pattern matches a path or its last part */
function globMatch(pattern: string, s: string) {
  const p = pattern.replace(/^\/+|\/+$/g, '')
  const re = new RegExp(
    `^${p
      .split('*')
      .map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  )
  return re.test(s)
}

/** the default install step: `bun install --frozen-lockfile` where a Bun lockfile sits, in the folder and in each folder just under it */
export function installDirs(wt: string) {
  const bun = (d: string) => existsSync(join(d, 'package.json')) && (existsSync(join(d, 'bun.lock')) || existsSync(join(d, 'bun.lockb')))
  const subs = readdirSync(wt)
    .filter((n) => !n.startsWith('.') && n !== 'node_modules')
    .map((n) => join(wt, n))
  return [wt, ...subs].filter(bun)
}

/** A fresh worktree's install step, before its agent starts: `cmd`, the project's own, in a shell; left out, the default
 *  (installDirs); `off`, none. Bun's download cache is shared by every worktree, so it takes seconds. A failure throws why. */
export async function install(wt: string, cmd?: string) {
  const step = cmd?.trim()
  if (step === 'off') return
  const jobs: { dir: string; cmd: string[]; text: string }[] = step
    ? [{ dir: wt, cmd: ['/bin/sh', '-c', step], text: step }]
    : installDirs(wt).map((dir) => ({ dir, cmd: ['bun', 'install', '--frozen-lockfile'], text: 'bun install --frozen-lockfile' }))
  for (const j of jobs) {
    const r = await sh(j.cmd, j.dir, { timeoutMs: 300_000 })
    const why = (r.err || r.out).split('\n').filter(Boolean).slice(-3).join(' ')
    if (!r.ok) throw new Error(`Install failed (${j.text}${j.dir === wt ? '' : ` in ${basename(j.dir)}/`}): ${why || `exit ${r.code}`}`)
  }
}

/**
 * The repo's setup for a fresh worktree, as herdr-projects does it: ignored files it lacks (.env and the like) are
 * copied in when .worktreeinclude in the repo names them. Nothing else runs.
 */
export async function copyIncludes(repo: string, wt: string) {
  if (!existsSync(join(repo, '.worktreeinclude'))) return []
  const patterns = readFileSync(join(repo, '.worktreeinclude'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  if (!patterns.length) return []
  const ignored = await git(repo, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory')
  const copied: string[] = []
  for (const entry of ignored.out.split('\n').filter(Boolean)) {
    const rel = entry.replace(/\/+$/, '')
    if (!patterns.some((g) => globMatch(g, rel) || globMatch(g, basename(rel)))) continue
    try {
      cpSync(join(repo, rel), join(wt, rel))
      copied.push(rel)
    } catch {
      /* one that can't be copied: the rest still are */
    }
  }
  return copied
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

/* ---------- GitHub, through gh ---------- */

/** gh for one repo: its host in GH_HOST (gh can't tell github.localhost from the remote alone), never a prompt */
export const gh = (g: GitHub, cwd: string, ...args: string[]) =>
  sh(['gh', ...args], cwd, { timeoutMs: 120_000, env: { GH_HOST: g.host, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' } })

/** the repo as gh's --repo takes it, host included */
export const R = (g: GitHub) => ['--repo', `${g.host}/${g.repo}`]
