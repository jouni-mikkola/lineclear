/** Retry failed links slowly, resetting only after a minute of continuous success. No timers or global state. */
export class LinkBackoff {
  private delay = 3000
  private healthySince?: number
  fail(now = Date.now()) {
    if (this.healthySince !== undefined && now - this.healthySince >= 60_000) this.delay = 3000
    this.healthySince = undefined
    const delay = this.delay
    this.delay = Math.min(30_000, this.delay * 2)
    return delay
  }
  success(now = Date.now()) {
    this.healthySince ??= now
  }
}
