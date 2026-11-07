// The watch on the head of a repo's merge lane: every step of it (fetch, rebase, check, merge) is read from the
// processes under it, so a head that waits on nothing is let go instead of holding every merge behind it.
import { addDecisions } from '../../../../src/decisions-store.ts'

/** a head whose processes show no progress for this long is released */
const IDLE_MS = 15 * 60_000

interface Head {
  /** when it took the line */
  since: number
  /** when its steps or processes last showed progress */
  moved: number
  /** its step and what its processes were, when last seen; not yet at its first look */
  seen?: string
  /** the last look */
  at: number
  dirs: string[]
  limit: number
}

export interface Release {
  id: string
  /** "no progress for 15 min" or "over the limit" */
  why: string
  /** minutes since it took the line */
  minutes: number
}

export class HeadWatch {
  private heads = new Map<string, Head>()

  begin(id: string, dirs: string[], limit: number, now = Date.now()) {
    this.heads.set(id, { since: now, moved: now, at: now, dirs, limit })
  }

  end(id: string) {
    this.heads.delete(id)
  }

  /**
   * One look at every head: `step` is its landing step and `work` its processes (their count and CPU ticks). A new
   * step, a process that came or went, or CPU used is progress.
   */
  look(now: number, step: (id: string) => string | undefined, work: (dirs: string[]) => { pids: number[]; ticks: number }): Release[] {
    const out: Release[] = []
    for (const [id, h] of this.heads) {
      const [s, w] = [step(id) ?? '', work(h.dirs)]
      const seen = `${s} ${w.pids.length} ${w.ticks}`
      if (h.seen !== undefined && seen !== h.seen) h.moved = now
      h.seen = seen
      h.at = now
      const minutes = Math.round((now - h.since) / 60_000)
      if (now - h.since >= h.limit) out.push({ id, why: 'over the limit', minutes })
      else if (now - h.moved >= IDLE_MS) out.push({ id, why: `no progress for ${Math.round((now - h.moved) / 60_000)} min`, minutes })
    }
    return out
  }
}

/** a row of the decisions table, where the rule loop logs its choices */
export function decide(step: string, kind: string, reason: string) {
  addDecisions(process.env, [{ time: new Date().toISOString(), project: '-', step, kind, reason }])
}

/** the newest finished check.yml run on main */
export interface MainRun {
  sha: string
  conclusion: string
}

export interface RedMainActions {
  /** puts a revert commit of the sha on main; false when it could not */
  revert: (sha: string) => Promise<boolean>
  /** opens a task to fix what the sha broke */
  fixTask: (sha: string, reverted: boolean) => Promise<void>
}

/** A red main is reverted and gets a fix task once per commit; a failed attempt is tried again on the next look. */
export class RedMainWatch {
  private handled = new Set<string>()

  async look(run: MainRun | undefined, act: RedMainActions): Promise<'reverted' | 'task only' | undefined> {
    if (run?.conclusion !== 'failure' || this.handled.has(run.sha)) return undefined
    this.handled.add(run.sha)
    const reverted = await act.revert(run.sha).catch(() => false)
    await act.fixTask(run.sha, reverted)
    decide('main-green', 'revert', `${run.sha.slice(0, 7)} turned main red: ${reverted ? 'reverted' : 'revert failed'}, fix task opened`)
    return reverted ? 'reverted' : 'task only'
  }
}
