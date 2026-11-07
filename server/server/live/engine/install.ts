import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import { boxDir, cp, exists, readdir, readFile } from '../mfs.ts'
import { git, sh } from './git.ts'

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
export async function installDirs(wt: string) {
  const bun = async (d: string) => (await exists(join(d, 'package.json'))) && ((await exists(join(d, 'bun.lock'))) || (await exists(join(d, 'bun.lockb'))))
  const subs = (await readdir(wt)).filter((n) => !n.startsWith('.') && n !== 'node_modules').map((n) => join(wt, n))
  const dirs = [wt, ...subs]
  const isBun = await Promise.all(dirs.map(bun))
  return dirs.filter((_, i) => isBun[i])
}

/** A fresh worktree's install step, before its agent starts: `cmd`, the project's own, in a shell; left out, the default
 *  (installDirs); `off`, none. Bun's download cache is shared by every worktree, so it takes seconds. A failure throws why. */
export async function install(wt: string, cmd?: string) {
  const step = cmd?.trim()
  if (step === 'off') return
  const jobs: { dir: string; cmd: string[]; text: string }[] = step
    ? [{ dir: wt, cmd: ['/bin/sh', '-c', step], text: step }]
    : (await installDirs(wt)).map((dir) => ({ dir, cmd: ['bun', 'install', '--frozen-lockfile'], text: 'bun install --frozen-lockfile' }))
  for (const j of jobs) {
    if (!step && (await linkStore(j.dir, wt))) continue
    const r = await sh(j.cmd, j.dir, { timeoutMs: 300_000 })
    const why = (r.err || r.out).split('\n').filter(Boolean).slice(-3).join(' ')
    if (!r.ok) throw new Error(`Install failed (${j.text}${j.dir === wt ? '' : ` in ${basename(j.dir)}/`}): ${why || `exit ${r.code}`}`)
    if (!step) await keepStore(j.dir, wt)
  }
}

/** The store entry of a lock file: its content hash, so a changed lock file makes a new entry. */
export function storeKey(lock: string | Buffer) {
  return createHash('sha256').update(lock).digest('hex').slice(0, 16)
}

/** Where the installed `node_modules` of the Bun project in `dir` (the worktree `wt` or a folder under it) is kept for every
 *  worktree with the same lock file. A worktree's own copy takes 400 MB and many agents multiply it; one linked copy takes none. */
export async function storePath(dir: string, wt: string) {
  const lock = (await exists(join(dir, 'bun.lock'))) ? 'bun.lock' : 'bun.lockb'
  return join(boxDir(), 'deps', storeKey(await readFile(join(dir, lock))), dir === wt ? '.' : basename(dir), 'node_modules')
}

/** `node_modules` of `dir` linked from the store when the store has its lock file's entry. */
async function linkStore(dir: string, wt: string) {
  const store = await storePath(dir, wt)
  const r = await sh(['/bin/sh', '-c', `[ -d "$1" ] && rm -rf "$2" && ln -s "$1" "$2"`, 'sh', store, join(dir, 'node_modules')], dir)
  if (r.ok) await excludeLink(dir)
  return r.ok
}

/** A `node_modules/` line in a .gitignore matches folders only, not the link, so git would list the link as new work. */
async function excludeLink(dir: string) {
  const script = `f="$(git rev-parse --git-path info/exclude)" && mkdir -p "$(dirname "$f")" && { grep -qx node_modules "$f" 2>/dev/null || echo node_modules >> "$f"; }`
  await sh(['/bin/sh', '-c', script], dir)
}

/** A fresh install moves into the store and is linked back, so the next worktree with this lock file links it. A failure here
 *  leaves the worktree's own install in place. */
async function keepStore(dir: string, wt: string) {
  const store = await storePath(dir, wt)
  const own = join(dir, 'node_modules')
  const script = `mkdir -p "$(dirname "$1")" && t="$1.$$" && mv "$2" "$t" && { mv -T "$t" "$1" 2>/dev/null || rm -rf "$t"; } && ln -s "$1" "$2"`
  const r = await sh(['/bin/sh', '-c', script, 'sh', store, own], dir)
  if (r.ok) await excludeLink(dir)
}

/**
 * The repo's setup for a fresh worktree, as herdr-projects does it: ignored files it lacks (.env and the like) are
 * copied in when .worktreeinclude in the repo names them. Nothing else runs.
 */
export async function copyIncludes(repo: string, wt: string) {
  if (!(await exists(join(repo, '.worktreeinclude')))) return []
  const patterns = (await readFile(join(repo, '.worktreeinclude'), 'utf8'))
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
      await cp(join(repo, rel), join(wt, rel))
      copied.push(rel)
    } catch {
      /* one that can't be copied: the rest still are */
    }
  }
  return copied
}
