// A coordinator or task agent that stopped, or runs without the files Lineclear starts it with now, started again by
// Lineclear itself with its session. After herdr restarts it restores each pane's last command, which may name files
// that moved since (hooks and prompts once lived in ~/.lineclear, now in ~/.lineclear/helper): that CLI exits at once,
// or runs without the hooks that tell Lineclear what it does. Tried a few times, further apart each time, then left to
// the human: a start that keeps failing never loops.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { decide } from './engine/lane-watch.ts'
import { herdr, type ProcessInfo } from './herdr.ts'

/** gone from herdr; its CLI exited, the shell at its prompt; or it runs on other files than it would start with now */
export type Wrong = 'gone' | 'exited' | 'stale'

const hashOf = (path: string) => {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return undefined
  }
}

/** whether a flag's value is what Lineclear wants: the same path, or for instructions the same content (a temp copy, or
 *  the text itself, runs the same agent) */
function sameValue(flag: string, got: string, want: string) {
  if (got === want) return true
  if (!flag.includes('append-system-prompt')) return false
  const mine = hashOf(want)
  if (!mine) return false
  if (hashOf(got) === mine) return true
  return createHash('sha256').update(got).digest('hex') === mine
}

/** what is wrong with an agent's pane from what runs in it (want: the path each flag should name); nothing while it is
 *  fine, or when its CLI isn't found in it */
export function paneWrong(kind: string, p: ProcessInfo, want: Record<string, string>): Wrong | undefined {
  if (p.shell_pid && p.foreground_process_group_id === p.shell_pid) return 'exited'
  return staleFlag(kind, p, want) ? 'stale' : undefined
}

/** the first flag its CLI runs without, or with another value than Lineclear starts it with now */
export function staleFlag(kind: string, p: ProcessInfo, want: Record<string, string>): string | undefined {
  const argv = p.foreground_processes?.find((x) => x.argv?.some((a) => basename(a) === kind))?.argv
  if (!argv) return undefined
  // pi renames its process, so its flags never show: nothing to compare
  if (kind === 'pi' && argv.length === 1) return undefined
  return Object.entries(want).find(([flag, path]) => {
    const i = argv.indexOf(flag)
    return i < 0 || !sameValue(flag, argv[i + 1] ?? '', path)
  })?.[0]
}

export interface RevivalTimes {
  /** how long it is seen wrong before it is started again: one starting, or herdr just back, settles first */
  grace: number
  /** how long after the try before each try may go: as many tries as gaps */
  gaps: number[]
  /** how long it runs well without a break before its tries count again from none */
  steady: number
  /** a start for the same reason twice within this is a loop: it is not tried a second time */
  loop: number
}

/** every agent's tries at starting it again: seen() while it is wrong says when to try and when to give up */
export class Revivals {
  private wrong = new Map<string, number>()
  private tries = new Map<string, number[]>()
  private given = new Set<string>()
  /** the reason of each key's last start, with its time */
  private last = new Map<string, { reason: string; at: number }>()
  /** since when it has been seen running well, without a break */
  private well = new Map<string, number>()
  /** whether it was at work when last seen running: told to carry on once it is back */
  private working = new Map<string, boolean>()

  constructor(readonly times: RevivalTimes = { grace: 20_000, gaps: [0, 60_000, 5 * 60_000], steady: 10 * 60_000, loop: 60 * 60_000 }) {}

  /** its status as herdr and its hooks tell it, while it runs */
  status(key: string, st: string) {
    if (st !== 'gone') this.working.set(key, st === 'working')
  }

  wasWorking(key: string) {
    return !!this.working.get(key)
  }

  /** seen running well: once that lasts a while without a break, its tries are forgotten */
  fine(key: string, now = Date.now()) {
    this.wrong.delete(key)
    const since = this.well.get(key) ?? now
    this.well.set(key, since)
    if (now - since < this.times.steady) return
    this.tries.delete(key)
    this.given.delete(key)
  }

  /** not looked at (herdr out of reach, or an agent not to keep running): seen wrong from the next look */
  skip(key: string) {
    this.wrong.delete(key)
    this.well.delete(key)
  }

  /** how long until a key seen wrong may be started again, or undefined when it isn't waiting: the deadline to wake at,
   *  instead of looking on a timer */
  wait(key: string, now = Date.now()): number | undefined {
    const since = this.wrong.get(key)
    if (since === undefined || this.given.has(key)) return undefined
    const tries = this.tries.get(key) ?? []
    const gap = tries.length ? tries[tries.length - 1] + (this.times.gaps[tries.length] ?? 0) : 0
    return Math.max(0, since + this.times.grace - now, gap - now)
  }

  /** seen wrong: 'go' to start it again now, 'give-up' once when its tries are used up, 'loop' once when it is wrong
   *  for the same reason as at its last start within the hour, else nothing yet */
  seen(key: string, now = Date.now(), reason = ''): 'go' | 'give-up' | 'loop' | undefined {
    this.well.delete(key)
    const since = this.wrong.get(key) ?? now
    this.wrong.set(key, since)
    if (now - since < this.times.grace || this.given.has(key)) return undefined
    const tries = this.tries.get(key) ?? []
    if (tries.length >= this.times.gaps.length) {
      this.given.add(key)
      return 'give-up'
    }
    if (tries.length && now - tries.at(-1)! < this.times.gaps[tries.length]) return undefined
    const before = this.last.get(key)
    if (reason && before?.reason === reason && now - before.at < this.times.loop) {
      this.given.add(key)
      return 'loop'
    }
    if (reason) this.last.set(key, { reason, at: now })
    this.tries.set(key, [...tries, now])
    // the start it sets going settles before it is judged again
    this.wrong.delete(key)
    return 'go'
  }
}

/** said once to the log and the rule loop's decisions: the agent still differs on a flag after it was started again */
export async function logLoop<R extends { kind: string }>(key: string, r: R | undefined, pane: string | undefined, filesOf: (r: R) => Record<string, string>) {
  const p = pane ? await herdr.processInfo(pane).catch(() => null) : null
  const flag = (r && p && staleFlag(r.kind, p, filesOf(r))) || 'a flag'
  const reason = `restart loop on outdated settings: ${key}'s agent still differs on ${flag} after starting it again, so it is left running`
  console.error(`lineclear: ${reason}`)
  decide(key.split('/')[0] ?? key, 'stall', reason)
}
