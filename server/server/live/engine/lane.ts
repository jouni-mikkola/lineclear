// The merge lane's rule for how a branch lands: only after the project's full check passes on the merged result, once. The check command is the project's, set in Lineclear's project settings.
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import * as Queue from './check-queue.ts'
import * as Runs from '../../../../src/check-runs.ts'
import { aheadCount, git, landed, mergeBase, rebase, sh } from './git.ts'

/**
 * A ready task on its way into main, from the first lineclear merge until it is merged or back at work: what it waits
 * for (GitHub's checks, its agent's rebase, the merge itself), since when, and when the checks should be through (ms).
 */
export interface Landing {
  step: 'checks' | 'rebase' | 'queue' | 'check' | 'merge'
  at: number
  due?: number
  /** in the queue for the check slot: how many checks are before it */
  ahead?: number
  /** its agent, at rest with the checks through, was told to merge once */
  nudged?: boolean
}

/** a landing task's line: "Checks running · ~3m", "Rebasing on main", "Waits for the check slot · 2 ahead", "Merging" */
export function landingLine(l: Landing, base = 'main', now = Date.now()) {
  if (l.step === 'rebase') return `Rebasing on ${base}`
  if (l.step === 'queue') return l.ahead ? `Waits for the check slot · ${l.ahead} ahead` : 'Waits for the check slot'
  if (l.step === 'check') return 'Check running'
  if (l.step === 'merge') return 'Merging'
  const left = l.due === undefined ? 0 : Math.ceil((l.due - now) / 60_000)
  return left > 0 ? `Checks running · ~${left}m` : 'Checks running'
}

// only a hang stop: the browser suite alone takes up to 40 minutes on a busy machine
const CHECK_TIMEOUT_MS = 45 * 60_000
const SMOKE_TIMEOUT_MS = 8 * 60_000
const TAIL = 4000
const FAST_GATES_TIMEOUT_MS = 2 * 60_000

/** the settings of the Lineclear project whose folder is this repo; none when it has no project */
function projectSettings(repo: string, env: Record<string, string | undefined>): Record<string, unknown> | undefined {
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

/** the merge tier of the Lineclear project whose folder is this repo, as one command; none when it has no project or no check */
export function projectCheck(repo: string, env: Record<string, string | undefined> = process.env): string | undefined {
  const s = projectSettings(repo, env) as { tiers?: { merge?: { commands?: unknown } }; check?: unknown } | undefined
  const merge = s?.tiers?.merge?.commands
  if (Array.isArray(merge) && merge.length > 0 && merge.every((c: unknown) => typeof c === 'string')) return merge.join(' && ')
  return typeof s?.check === 'string' && s.check.trim() ? s.check.trim() : undefined
}

/** how long a merge may hold its repo's line: the project's `turnLimitMinutes`, else 30 minutes */
export function turnLimitMs(repo: string, env: Record<string, string | undefined> = process.env): number {
  const m = projectSettings(repo, env)?.turnLimitMinutes
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

/**
 * the project's check in the branch's folder, which holds the merged result once the branch is rebased on `base`. The
 * run goes in the check log; one that fails only on tests in quarantine counts as passed.
 */
async function runCheck(
  repo: string,
  machine: string,
  wt: string,
  command: string,
  id: string,
  onPid: (pid: number) => void,
  readLoad?: () => number[],
  rerun = false,
): Promise<{ ok: boolean; tail: string }> {
  // git runs where the task's folder is: the machine the check runs on, not the server's
  const where = {
    repo,
    machine,
    commit: (await git(wt, 'rev-parse', 'HEAD')).out,
    branch: (await git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).out,
    dirty: (await git(wt, 'status', '--porcelain')).out.trim() !== '',
  }
  const meter = Runs.loadMeter(readLoad)
  const started = performance.now()
  const r = await sh(['sh', '-c', `${command} 2>&1`], wt, { timeoutMs: CHECK_TIMEOUT_MS, onPid })
  const text = `${r.out}${r.ok ? '' : `\n${r.err}`}`.trim()
  const failed = r.ok ? [] : Runs.failedTests(text)
  const outside = r.ok ? [] : Runs.failedOutside(text)
  const gate = r.ok || failed.length > 0 ? undefined : Runs.failedGate(text)
  const passes = !r.ok && Runs.onlyQuarantined(command, text, r.code, failed, Runs.quarantined(where.repo))
  const seconds = (performance.now() - started) / 1000
  const load = meter()
  // a timeout, a kill or a loaded machine says nothing about the change: a run that names no test or gate gets one more try
  const again = !r.ok && !passes && !rerun && Runs.worthRerun({ failed, gate, ...load })
  Runs.recordRun({
    at: Date.now(),
    ...where,
    tier: 'merge',
    command,
    seconds,
    ...load,
    ok: r.ok,
    failed,
    ...(r.ok ? {} : { causes: Runs.failureCauses(text, r.code, failed, gate) }),
    ...(gate ? { gate } : {}),
    ...(outside.length > 0 ? { outside } : {}),
    ...(passes ? { quarantined: true } : {}),
    ...(again ? { rerun: true } : {}),
    group: `${id}-${Date.now()}`,
  })
  if (again) return runCheck(repo, machine, wt, command, id, onPid, readLoad, true)
  const held = rerun && !r.ok && !passes && failed.length === 0 && !gate
  return { ok: r.ok || passes, tail: `${held ? 'held, cause unnamed: it failed twice and named no test or gate\n' : ''}${text.slice(-TAIL)}` }
}

/** A merge whose caller may have left (past the deadline) has nobody to hear its error: one not sent back to the agent yet is sent now. */
export async function tellIfLeft<R extends { ok: boolean; error?: string }>(left: boolean, r: R, send: (text: string) => Promise<unknown>): Promise<R> {
  if (left && !r.ok && !r.error?.includes('Sent back to')) await send(r.error ?? 'Merge failed.')
  return r
}

/**
 * Rebases the branch on `base` and runs the check on it, in its project's turn for a full check (`repo` is the
 * server's folder of the project, so every machine's task for it is in one line). The rebase waits for
 * the turn too, so the check runs on main as it is then and the branch is touched only while it runs. A branch that
 * moved, has edits, or whose task is `gone` back to work while it waited is left as it is.
 */
export async function checkInTurn(
  id: string,
  repo: string,
  wt: string,
  base: string,
  command: string,
  o: {
    gone: () => string | undefined
    waiting: (ahead: number, noSlot: number) => unknown
    env?: Record<string, string | undefined>
    slotMachine?: string
    readLoad?: () => number[]
  },
) {
  const queued = (await git(wt, 'rev-parse', 'HEAD')).out
  /** why the merge gives up its turn, or undefined when it goes on */
  const left = async () => {
    const gone = o.gone()
    if (gone) return gone
    if ((await git(wt, 'rev-parse', 'HEAD')).out !== queued) return 'its branch moved'
    if ((await git(wt, 'status', '--porcelain')).out.trim()) return 'its folder has uncommitted changes'
    return undefined
  }
  // a task on another machine waits in that machine's line and checks there, never in the main machine's
  const machine = Runs.machineOf(o.slotMachine ? { ...(o.env ?? process.env), LINECLEAR_MACHINE: o.slotMachine } : o.env)
  return Queue.inTurn(
    id,
    Queue.lineOn(repo, o.slotMachine, o.env),
    async (track) => {
      const why = await left()
      if (why) return { step: 'left' as const, why }
      const before = (await git(wt, 'rev-parse', 'HEAD')).out
      if (!(await rebase(wt, base)).ok) return { step: 'conflict' as const }
      return { step: 'checked' as const, before, ...(await runCheck(repo, machine, wt, command, id, track, o.readLoad)) }
    },
    {
      env: o.env,
      slotMachine: o.slotMachine,
      waiting: o.waiting,
      dropped: () => {
        const why = o.gone()
        return why ? { step: 'left' as const, why } : undefined
      },
    },
  )
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
