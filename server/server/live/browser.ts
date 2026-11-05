import { BrowsersSessions } from './browser-sessions.ts'
import { browserBin, browserEnv, type BrowsersOpts } from './browser-helpers.ts'
export type { BrowserClient, BrowserBridge, BrowsersOpts } from './browser-helpers.ts'
export { profileOf, browserEnv, usedMark, chromesIn, elapsed } from './browser-helpers.ts'

export class Browsers extends BrowsersSessions {
  constructor(o: BrowsersOpts) {
    super(o)
    this.bin = o.bin ?? browserBin()
    this.env = o.env ?? browserEnv
    this.ready = this.check()
  }
}
