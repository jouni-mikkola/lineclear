import { randomUUID } from 'node:crypto'
import { herdr } from './herdr.ts'
import { holdBack, machineNews } from './quiet.ts'
import { paneWrong, type Wrong } from './revive.ts'
import { holdFrom, type OutItem, type Hold, type SendOpts, type Sent } from './agents-helpers.ts'
import { AgentsDelivery } from './agents-delivery.ts'

export class AgentsSending extends AgentsDelivery {
  /** what is wrong with this agent's run: gone from herdr, its CLI exited in its pane, or it runs on outdated files;
   *  nothing while it is fine, null when herdr can't say. One on outdated files is left alone while herdr sees it at
   *  work or asking (a turn is never cut for this) */
  async wrong(key: string): Promise<Wrong | undefined | null> {
    const r = this.records[key]
    const a = this.info(key)
    if (!r) return undefined
    if (!a) return 'gone'
    const p = await herdr.processInfo(a.pane_id).catch(() => null)
    // herdr didn't say: neither well nor wrong
    if (!p) return null
    const w = paneWrong(r.kind, p, this.filesOf(r))
    return w === 'stale' && (a.agent_status === 'working' || a.agent_status === 'blocked') ? undefined : w
  }

  /** whether it was at work when last seen running, even while it is gone */
  wasWorking(key: string) {
    return !!this.records[key]?.working
  }

  /** being started or stopped right now */
  busy(key: string) {
    return this.starting.has(key) || this.stopping.has(key)
  }

  /** started again by `start` (that resumes its session), its pane closed first where it still holds it (its CLI
   *  exited, or runs on outdated files). Meanwhile what you send waits for the one it starts, as in a restart.
   *  It counts as stopping only while its pane closes: `start` goes through ensure(), which refuses a stopping one */
  async relaunch(key: string, close: boolean, start: () => Promise<unknown>) {
    this.secretAccess.revoke(key)
    this.routes.delete(key)
    this.stopping.add(key)
    try {
      const a = close ? this.info(key) : undefined
      if (a) {
        await herdr.closePane(a.pane_id).catch(() => undefined)
        await this.refresh()
      }
    } finally {
      this.stopping.delete(key)
    }
    try {
      await start()
    } finally {
      this.deliver(key)
    }
  }

  /* ---------- sending ---------- */

  /** why what you send would wait now, or nothing: it goes in at once. Typed text could pick an option on a menu or
   *  permission prompt, so it waits for the prompt to go; a starting agent isn't taking input yet; a CLI command waits for
   *  the turn to end. Anything else goes in even mid-turn: the CLI takes it at its next step. */
  holdOf(key: string, item?: Pick<OutItem, 'idle'>): Hold | undefined {
    return this.heldBy(key, item) ?? (this.unready.has(key) ? 'start' : undefined)
  }

  /** what you send: in at once, unless the agent is on a menu or still starting (see holdOf). Returns whether it waits.
   *  What a screen sent (with its id) waits only that long: when the agent can't take it or won't start, the screen hears
   *  so and offers Retry. */
  send(key: string, text: string, o: SendOpts = {}): Promise<Sent> {
    const cid = o.cid
    if (!cid) return this.sendNow(key, text, o)
    // the screen sends again what it heard no answer for, maybe while the first is still on its way: once is enough
    const on = this.inflight.get(cid)
    if (on) return on
    const p = this.sendNow(key, text, o).finally(() => this.inflight.delete(cid))
    this.inflight.set(cid, p)
    return p
  }

  protected async sendNow(key: string, text: string, { reaction, ensure, cid, idle, command, generation }: SendOpts): Promise<Sent> {
    // before any herdr call: a done task has no pane, so a send would only end in "pane not found"
    const over = this.taskEnded?.(key)
    if (over) throw new Error(over)
    // machine news is never a message to an agent (quiet.ts): rules and the status line carry it
    const news = machineNews(text)
    if (news) {
      holdBack(news, key)
      return { waiting: false, item: { id: randomUUID(), key, text, at: Date.now(), ...(cid ? { cid } : {}) } }
    }
    if (cid?.startsWith('requested-news:') && this.newsReceipts.includes(cid)) return { waiting: false, item: { id: cid, cid, key, text, at: Date.now() } }
    const again = cid && this.outbox.find((o) => o.cid === cid)
    if (again) return { waiting: true, waitsFor: this.whyWaits(key), item: again }
    const done = cid && this.delivered.find((o) => o.cid === cid)
    if (done) return { waiting: false, item: done }
    // sent again after it failed: it is on its way once more
    if (cid) this.failures = this.failures.filter((f) => f.cid !== cid)
    const item: OutItem = {
      generation,
      id: randomUUID(),
      key,
      text,
      reaction,
      at: Date.now(),
      ...(cid ? { cid } : {}),
      ...(idle ? { idle } : {}),
      ...(command ? { command } : {}),
    }
    if ((item.launch && item.launch !== this.records[key]?.launch) || (this.acceptInput && !this.acceptInput(item))) return { waiting: false, item }
    if (this.status(key) === 'gone' && ensure && cid && !this.deliveryPaused.has(key)) {
      try {
        await ensure()
      } catch (e) {
        throw new Error(`The agent didn't start: ${(e as Error).message}`)
      }
      if (this.status(key) === 'gone') throw new Error(this.reachable ? "The agent isn't running." : "Can't reach herdr.")
    }
    await this.beforeInput?.(key)
    if ((item.launch && item.launch !== this.records[key]?.launch) || (this.acceptInput && !this.acceptInput(item))) return { waiting: false, item }
    // what waits goes first, so nothing overtakes it
    let hold: Hold | undefined
    if (!this.holdOf(key, item) && !this.outbox.some((o) => o.key === key)) {
      try {
        await this.put(key, item)
        this.unready.delete(key)
        this.went(item)
        this.emit('sent', item)
        return { waiting: false, item }
      } catch (e) {
        // a menu came up just now, or the agent just started and herdr doesn't take input for it yet: it waits
        hold = holdFrom(e)
        if (hold === 'start' && !this.unready.has(key)) this.unready.set(key, Date.now())
        if (cid && !hold) throw new Error(`The agent didn't take it: ${(e as Error).message}`)
        /* falls through: it waits */
      }
    }
    this.outbox.push(item)
    this.save()
    const st = this.status(key)
    if (st === 'gone' && ensure)
      ensure()
        .then(() => this.deliver(key))
        .catch(() => undefined)
    else this.deliver(key)
    return { waiting: true, waitsFor: hold ?? this.whyWaits(key), item }
  }

  /** why what waits for this agent waits: the first in line holds the rest */
  protected whyWaits(key: string) {
    const first = this.outbox.find((o) => o.key === key)
    return first ? this.holdOf(key, first) : undefined
  }

  /** what a screen sent that couldn't go in, in the last ten minutes */
  failedLately(key: string) {
    const now = Date.now()
    return this.failures.filter((f) => f.key === key && now - f.at < 600_000).map(({ cid, error }) => ({ cid, error }))
  }

  waiting(key: string) {
    return this.outbox.filter((o) => o.key === key)
  }

  /** what went in with a screen's id in the last ten minutes, oldest first; at is when it went in */
  sentLately(key: string) {
    const now = Date.now()
    return this.delivered.filter((o) => o.key === key && now - o.at < 600_000)
  }

  /** what went in since this time (the last ten minutes at most) */
  typedSince(key: string, at: number) {
    return this.typed.filter((o) => o.key === key && o.at > at)
  }

  async keys(key: string, keys: string[]) {
    const a = this.info(key)
    if (a) await herdr.paneKeys(a.pane_id, keys)
  }

  async text(key: string, text: string) {
    const a = this.info(key)
    if (a) await herdr.paneText(a.pane_id, text)
  }

  /** its terminal's last lines as plain text */
  async screenText(key: string): Promise<string> {
    const a = this.info(key)
    return a ? herdr.read(a.pane_id, 'text', 60) : ''
  }

  watchTerminals(keys: string[]) {
    const panes = new Set(keys.map((k) => this.info(k)?.pane_id).filter(Boolean) as string[])
    for (const p of this.sizes.keys()) if (!panes.has(p)) this.sizes.delete(p)
    this.terminalClock.watch(keys)
  }

  /** a deleted task's agent, forgotten: its record (so its chat no longer reads its CLI's log) and what waited for it */
  forget(key: string) {
    this.secretAccess.revoke(key)
    this.routes.delete(key)
    const r = this.records[key]
    if (r && this.byName.get(r.name) === key) this.byName.delete(r.name)
    delete this.records[key]
    this.outbox = this.outbox.filter((o) => o.key !== key)
    this.failures = this.failures.filter((f) => f.key !== key)
    this.stranded.delete(key)
    this.save()
  }

  /** a turn under way ended cleanly before its run ends (a restart): interrupted, then a few seconds for the CLI to
   *  stop and write what it had; still at work after that, it throws and is left as it is */
  async stopTurn(key: string, ms = 15_000) {
    if (this.status(key) !== 'working') return
    await this.interrupt(key)
    for (const end = Date.now() + ms; this.status(key) === 'working'; ) {
      if (Date.now() > end) throw new Error('It is still working after an interrupt: try again in a moment.')
      await new Promise((r) => setTimeout(r, 500))
      await this.refresh()
    }
    // what it wrote last reaches its log
    await new Promise((r) => setTimeout(r, 500))
  }

  async interrupt(key: string) {
    const a = this.info(key)
    if (a) await herdr.sendKeys(this.records[key].name, ['esc']).catch(() => undefined)
  }
}
