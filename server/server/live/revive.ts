// An agent that stopped or runs on other launch files than now is started again, a few times, further apart each time.
export type Wrong = 'gone' | 'exited' | 'stale'

/** grace: wrong this long before a start; gaps: wait before each try, as many tries as gaps; steady: running well this long forgets the tries */
export interface RevivalTimes {
  grace: number
  gaps: number[]
  steady: number
}

export class Revivals {
  private wrong = new Map<string, number>()
  private tries = new Map<string, number[]>()
  private given = new Set<string>()
  private well = new Map<string, number>()
  private working = new Map<string, boolean>()

  constructor(readonly times: RevivalTimes = { grace: 20_000, gaps: [0, 60_000, 5 * 60_000], steady: 10 * 60_000 }) {}

  status = (key: string, st: string) => st !== 'gone' && this.working.set(key, st === 'working')

  wasWorking = (key: string) => !!this.working.get(key)

  fine(key: string, now = Date.now()) {
    this.wrong.delete(key)
    const since = this.well.get(key) ?? now
    this.well.set(key, since)
    if (now - since < this.times.steady) return
    this.tries.delete(key)
    this.given.delete(key)
  }

  skip(key: string) {
    this.wrong.delete(key)
    this.well.delete(key)
  }

  wait(key: string, now = Date.now()): number | undefined {
    const since = this.wrong.get(key)
    if (since === undefined || this.given.has(key)) return undefined
    const tries = this.tries.get(key) ?? []
    const gap = tries.length ? tries[tries.length - 1] + (this.times.gaps[tries.length] ?? 0) : 0
    return Math.max(0, since + this.times.grace - now, gap - now)
  }

  /** seen wrong: 'go' to start it again now, 'give-up' once when its tries are used up, else nothing yet */
  seen(key: string, now = Date.now()): 'go' | 'give-up' | undefined {
    this.well.delete(key)
    const since = this.wrong.get(key) ?? now
    this.wrong.set(key, since)
    if (now - since < this.times.grace || this.given.has(key)) return undefined
    const tries = this.tries.get(key) ?? []
    if (tries.length >= this.times.gaps.length) return this.given.add(key) && 'give-up'
    if (tries.length && now - tries[tries.length - 1] < this.times.gaps[tries.length]) return undefined
    this.tries.set(key, [...tries, now])
    this.wrong.delete(key)
    return 'go'
  }
}
