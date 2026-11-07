// The merge lane's rule for how a branch lands: only after the project's full check passes on the merged result, once. The check command is the project's, set in Lineclear's project settings.
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { aheadCount, git, landed, mergeBase, sh } from './git.ts'

/**
 * A ready task on its way into main, from the first lineclear merge until it is merged or back at work: what it waits
 * for (GitHub's checks, its agent's rebase, the merge itself), since when, and when the checks should be through (ms).
 */
export interface Landing {
  step: 'checks' | 'rebase' | 'merge'
  at: number
  due?: number
  /** its agent, at rest with the checks through, was told to merge once */
  nudged?: boolean
}

/** a landing task's line: "Checks running · ~3m", "Rebasing on main", "Merging" */
export function landingLine(l: Landing, base = 'main', now = Date.now()) {
  if (l.step === 'rebase') return `Rebasing on ${base}`
  if (l.step === 'merge') return 'Merging'
  const left = l.due === undefined ? 0 : Math.ceil((l.due - now) / 60_000)
  return left > 0 ? `Checks running · ~${left}m` : 'Checks running'
}

const SMOKE_TIMEOUT_MS = 8 * 60_000
const TAIL = 4000
const FAST_GATES_TIMEOUT_MS = 2 * 60_000

/** the settings of the Lineclear project whose folder is this repo; none when it has no project */
function settingsOfRepo(repo: string, env: Record<string, string | undefined>): Record<string, unknown> | undefined {
  const dir = join(env.LINECLEAR_CONFIG ?? join(homedir(), '.config', 'lineclear'), 'projects')
  if (!existsSync(dir)) return undefined
  for (const name of readdirSync(dir)) {
    try {
      const s = JSON.parse(readFileSync(join(dir, name, 'settings.json'), 'utf8'))
      if (typeof s?.repo === 'string' && resolve(s.repo) === resolve(repo)) return s
    } catch {
      // a folder with no readable settings is not a project
    }
  }
  return undefined
}

/** how long a merge may hold its repo's line: the project's `turnLimitMinutes`, else 30 minutes */
export function turnLimitMs(repo: string, env: Record<string, string | undefined> = process.env): number {
  const m = settingsOfRepo(repo, env)?.turnLimitMinutes
  return (typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : 30) * 60_000
}

/** the files the branch changed that a commit on `base` changed too, since the branch left it */
export async function sharedFiles(wt: string, base: string): Promise<string[]> {
  const mb = await mergeBase(wt, base)
  const changed = async (to: string) => (await git(wt, 'diff', '--name-only', '--no-renames', mb, to)).out.split('\n').filter(Boolean)
  const theirs = new Set(await changed(base))
  return (await changed('HEAD')).filter((f) => theirs.has(f))
}

/** the files that clash when the branch is merged into `base`; undefined when it merges cleanly */
export async function conflictFiles(wt: string, base: string): Promise<string[] | undefined> {
  const r = await git(wt, 'merge-tree', '--write-tree', '--name-only', '--no-messages', base, 'HEAD')
  if (r.ok) return undefined
  return r.out.split('\n').slice(1).filter(Boolean)
}

/** A merge whose caller may have left (past the deadline) has nobody to hear its error: one not sent back to the agent yet is sent now. */
export async function tellIfLeft<R extends { ok: boolean; error?: string }>(left: boolean, r: R, send: (text: string) => Promise<unknown>): Promise<R> {
  if (left && !r.ok && !r.error?.includes('Sent back to')) await send(r.error ?? 'Merge failed.')
  return r
}

/**
 * Lineclear's own repo (it has the smoke check and the command): the branch's service must start before it lands. The
 * smoke check starts it from the branch's folder on free ports with a scratch data folder. `refuse` gets the words for
 * the agent (`{id}` is the task) and answers for the merge; undefined when it passed or the repo is not Lineclear's.
 */
export async function smokeGate<T>(wt: string, base: string, refuse: (message: string) => Promise<T>): Promise<T | undefined> {
  if (!existsSync(join(wt, 'scripts', 'smoke.ts')) || !existsSync(join(wt, 'bin', 'lineclear'))) return undefined
  if ((await aheadCount(wt, base)) === 0 || (await landed(wt, 'HEAD', base))) return undefined
  const r = await sh(['bun', 'scripts/smoke.ts', 'branch'], wt, { timeoutMs: SMOKE_TIMEOUT_MS })
  if (r.ok) return undefined
  const failed = (r.out || r.err || `the smoke check stopped with exit code ${r.code}`).slice(-TAIL)
  return refuse(
    `This branch does not start as a service, so nothing was merged. The smoke check failed:\n${failed}\nFix it, commit, then run lineclear merge {id} again.`,
  )
}

/**
 * Lineclear's own repo (it has the fast gates script): the gates of the check that run no test (roadmap, parts, media,
 * code gates) run in the branch's folder when its agent reports ready, so a branch that would be red in the merge lane for
 * one is sent back before it joins the lane. Returns the gates' message, or undefined when they passed or the repo has none.
 */
export async function fastGatesFailure(wt: string, base: string): Promise<string | undefined> {
  if (!existsSync(join(wt, 'scripts', 'fast-gates.ts')) || !existsSync(join(wt, 'bin', 'lineclear'))) return undefined
  if ((await aheadCount(wt, base)) === 0) return undefined
  const r = await sh(['bun', 'scripts/fast-gates.ts'], wt, { timeoutMs: FAST_GATES_TIMEOUT_MS })
  // only a gate that said no refuses: a timeout or a missing tool on a busy machine must not stop a task from reporting
  if (r.code !== 1) return undefined
  return (r.err || r.out).slice(-TAIL)
}
