// A chat agent idle this long holds its pane for nothing: it is closed, and the next message starts it again with its session.

/** how long a chat agent may sit idle before its pane closes */
export const IDLE_CLOSE_MS = 20 * 60_000

export class ChatIdle {
  private since = new Map<string, number>()

  constructor(readonly limit = IDLE_CLOSE_MS) {}

  /** an agent's status changed: idle starts its clock (kept if already running), anything else clears it */
  status(key: string, st: string, now = Date.now()) {
    if (st === 'idle' || st === 'done') this.since.set(key, this.since.get(key) ?? now)
    else this.since.delete(key)
  }

  forget = (key: string) => this.since.delete(key)

  /** the keys idle for the limit or longer */
  due(now = Date.now()): string[] {
    return [...this.since].filter(([, at]) => now - at >= this.limit).map(([key]) => key)
  }

  /** ms until the next key is due, or undefined with none waiting */
  next(now = Date.now()): number | undefined {
    const ats = [...this.since.values()]
    return ats.length ? Math.max(0, Math.min(...ats) + this.limit - now) : undefined
  }
}
