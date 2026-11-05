// The watch on the head of a repo's merge lane: every step of it (fetch, rebase, check, merge) is read from the
// processes under it, so a head that waits on nothing is let go instead of holding every merge behind it.
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** a head whose processes show no progress for this long is released */
const IDLE_MS = 15 * 60_000

interface Head {
  /** when it took the line, moved forward while it waits for the check slot */
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
   * step, a process that came or went, or CPU used is progress. A head waiting for the check slot holds nothing yet.
   */
  look(now: number, step: (id: string) => string | undefined, work: (dirs: string[]) => { pids: number[]; ticks: number }): Release[] {
    const out: Release[] = []
    for (const [id, h] of this.heads) {
      const [s, w] = [step(id) ?? '', work(h.dirs)]
      const seen = `${s} ${w.pids.length} ${w.ticks}`
      if (s === 'queue') h.since += now - h.at
      if (s === 'queue' || (h.seen !== undefined && seen !== h.seen)) h.moved = now
      h.seen = seen
      h.at = now
      const minutes = Math.round((now - h.since) / 60_000)
      if (now - h.since >= h.limit) out.push({ id, why: 'over the limit', minutes })
      else if (now - h.moved >= IDLE_MS) out.push({ id, why: `no progress for ${Math.round((now - h.moved) / 60_000)} min`, minutes })
    }
    return out
  }
}

/** a line of the rule loop's decisions.jsonl */
export function decide(step: string, kind: string, reason: string) {
  const dir = process.env.LINECLEAR_CONFIG || join(homedir(), '.config', 'lineclear')
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, 'decisions.jsonl'), `${JSON.stringify({ time: new Date().toISOString(), project: '-', step, kind, reason })}\n`)
}
