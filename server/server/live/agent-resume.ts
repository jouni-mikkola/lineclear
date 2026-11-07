// An RPC agent dies with its server. After a restart each one that was live starts again from its own session; one cut
// mid-turn is told once to carry on. A start that keeps failing stops with a card instead of looping.
export interface ResumeHost {
  /** a task agent Lineclear keeps running that has no child now */
  resumable(key: string): boolean
  /** read before the start: the start itself sets its status to idle */
  wasWorking(key: string): boolean
  /** the existing start call: resumes the record's session */
  start(key: string): Promise<unknown>
  /** the one "carry on" for a turn that was cut */
  carryOn(key: string): Promise<unknown>
  /** the tries are used up */
  gaveUp(key: string): void
}

export interface ResumeTimes {
  /** wait before each try after a failure */
  gaps: number[]
  /** failed starts within this long end the tries */
  window: number
}

const HOUR = 60 * 60_000

export class Resumes {
  private failures = new Map<string, number[]>()
  private running = new Set<string>()

  constructor(
    private host: ResumeHost,
    readonly times: ResumeTimes = { gaps: [0, 20_000, 60_000], window: HOUR },
  ) {}

  private recent(key: string, now: number) {
    const list = (this.failures.get(key) ?? []).filter((at) => now - at < this.times.window)
    this.failures.set(key, list)
    return list
  }

  /** its tries are used up: it stays stopped until the hour has passed */
  stopped(key: string, now = Date.now()) {
    return this.recent(key, now).length >= this.times.gaps.length
  }

  /** every agent that should run and does not, started at once and side by side */
  async all(keys: string[]) {
    await Promise.all(keys.filter((k) => !this.running.has(k) && this.host.resumable(k) && !this.stopped(k)).map((k) => this.one(k)))
  }

  private async one(key: string) {
    this.running.add(key)
    try {
      const working = this.host.wasWorking(key)
      for (;;) {
        const tries = this.recent(key, Date.now())
        const gap = this.times.gaps[tries.length] ?? 0
        if (gap) await new Promise((r) => setTimeout(r, gap))
        try {
          await this.host.start(key)
          this.failures.delete(key)
          if (working) await this.host.carryOn(key).catch(() => undefined)
          return
        } catch (e) {
          console.error(`lineclear: couldn't start ${key}'s agent again: ${(e as Error).message}`)
          tries.push(Date.now())
          this.failures.set(key, tries)
          if (this.stopped(key)) return this.host.gaveUp(key)
        }
      }
    } finally {
      this.running.delete(key)
    }
  }
}
