/** a piece of work with its next deadline: `due` is read each time the clock arms, `run` is called once it passed */
export type Job = { due: () => number; run: (now: number) => void }

/** runs once, `first` ms after the clock starts, then every `period` ms (never again: no period) */
export function every(first: number, period: number | undefined, run: () => void, start = Date.now()): Job {
  let next = start + first
  return {
    due: () => next,
    run: (now) => {
      next = period === undefined ? Infinity : now + period
      run()
    },
  }
}

/** The engine's one timer: it sleeps until the earliest deadline of its jobs, runs those that are due and sleeps again. */
export class Clock {
  /** when the timer fires next (a test reads it) */
  armedFor = Infinity
  private timer?: ReturnType<typeof setTimeout>

  /** @param reread the longest sleep: a deadline created since the last arming is seen within this */
  constructor(
    private jobs: Job[],
    private reread: number,
  ) {}

  start(now = Date.now()) {
    this.arm(now)
  }

  tick(now = Date.now()) {
    // a job that throws must not stop the timer for the others
    for (const j of this.jobs) {
      try {
        if (j.due() <= now) j.run(now)
      } catch {}
    }
    this.arm(now)
  }

  stop() {
    clearTimeout(this.timer)
    this.armedFor = Infinity
  }

  private arm(now: number) {
    clearTimeout(this.timer)
    this.armedFor = Math.min(now + this.reread, ...this.jobs.map((j) => j.due()))
    this.timer = setTimeout(() => this.tick(), Math.max(0, this.armedFor - Date.now()))
    this.timer.unref?.()
  }
}
