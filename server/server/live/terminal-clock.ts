// herdr sends no event when a pane's output changes, so a terminal on screen is read again on a clock.
import type { TermScreen } from '../../shared/types.ts'

/** a terminal is read at most once in this time and only this many are watched: 2 reads a second at most */
const MIN_PERIOD_MS = 1000
const MAX_WATCHED = 2

export class TerminalClock {
  private timer?: ReturnType<typeof setInterval>
  private keys: string[] = []
  /** what each terminal showed last, so only a change goes out; while a read is on its way, that read's own token */
  private shown = new Map<string, string | symbol>()

  constructor(
    private read: (key: string) => Promise<TermScreen>,
    private send: (key: string, screen: TermScreen) => void,
    private everyMs: number,
  ) {}

  /** reads these terminals from now on, and no other; one still watched keeps its clock and what it showed */
  watch(keys: string[]) {
    keys = keys.slice(0, MAX_WATCHED)
    this.keys = keys
    for (const k of this.shown.keys()) if (!keys.includes(k)) this.shown.delete(k)
    if (!keys.length) return this.stop()
    this.timer ??= setInterval(
      () => {
        for (const k of this.keys) this.tick(k)
      },
      Math.max(this.everyMs, MIN_PERIOD_MS),
    )
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.keys = []
    this.shown.clear()
  }

  private tick(key: string) {
    const last = this.shown.get(key)
    if (typeof last === 'symbol') return
    const reading = Symbol(key)
    this.shown.set(key, reading)
    // a read that comes back after its terminal was dropped, or watched anew, is not this terminal's news any more
    const mine = () => this.shown.get(key) === reading
    this.read(key).then(
      (s) => {
        if (!mine()) return
        const shown = `${s.cols}x${s.rows}:${s.ansi}`
        this.shown.set(key, shown)
        if (shown !== last) this.send(key, s)
      },
      () => mine() && this.shown.set(key, last ?? ''),
    )
  }
}
