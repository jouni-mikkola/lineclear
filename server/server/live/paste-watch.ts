import { herdr } from './herdr.ts'
import { showsPaste } from './commands.ts'

/** how long after its start an agent's pane may still hold the pasted brief */
const FRESH_MS = 120_000
const AGAIN_MS = 5000

/** Which fresh agents' panes show the pasted brief, not yet sent. Herdr's events say nothing of the screen, so a fresh
 *  pane is looked at when its status changes and every few seconds while it is fresh or still shows the paste. */
export class PasteWatch {
  protected shown = new Set<string>()
  protected timers = new Map<string, ReturnType<typeof setTimeout>>()

  has(key: string) {
    return this.shown.has(key)
  }

  async look(key: string, started: number, paneOf: () => string | undefined) {
    clearTimeout(this.timers.get(key))
    this.timers.delete(key)
    const fresh = Date.now() - started < FRESH_MS
    const pane = paneOf()
    if (pane && (fresh || this.shown.has(key)) && showsPaste(await herdr.visible(pane).catch(() => ''))) this.shown.add(key)
    else this.shown.delete(key)
    if (pane && (fresh || this.shown.has(key))) this.timers.set(key, setTimeout(() => void this.look(key, started, paneOf), AGAIN_MS).unref())
  }

  stop() {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }
}
