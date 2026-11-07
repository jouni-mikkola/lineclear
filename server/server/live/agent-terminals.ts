import type { TermScreen } from '../../shared/types.ts'
import { herdr, type AgentInfo } from './herdr.ts'
import { TerminalClock } from './terminal-clock.ts'
import { BOX } from './box.ts'

/** the terminals a screen watches: each pane's recent lines and size, read as they change */
export class AgentTerminals {
  /** each watched pane's size in cells, and when it was read */
  private sizes = new Map<string, { at: number; size: { cols: number; rows: number } | null }>()
  /** each read of another machine's pane is an SSH connection of its own, so it is read less often */
  private clock: TerminalClock

  constructor(
    private info: (key: string) => AgentInfo | undefined,
    output: (key: string, screen: TermScreen) => void,
  ) {
    this.clock = new TerminalClock((k) => this.screen(k), output, BOX ? 1500 : 500)
  }

  /** its terminal's recent lines and the pane's size, so a screen draws them at its real width; the size is read again
   *  at most every few seconds, not on every change on the screen */
  async screen(key: string): Promise<TermScreen> {
    const a = this.info(key)
    if (!a) return { ansi: '' }
    const known = this.sizes.get(a.pane_id)
    const fresh = known && Date.now() - known.at < 3000
    const [ansi, size] = await Promise.all([herdr.read(a.pane_id, 'ansi', 300), fresh ? known.size : herdr.size(a.pane_id).catch(() => null)])
    if (!fresh) this.sizes.set(a.pane_id, { at: Date.now(), size })
    return { ansi, ...size }
  }

  watch(keys: string[]) {
    const panes = new Set(keys.map((k) => this.info(k)?.pane_id))
    for (const p of this.sizes.keys()) if (!panes.has(p)) this.sizes.delete(p)
    this.clock.watch(keys)
  }

  stop() {
    this.clock.stop()
  }
}
