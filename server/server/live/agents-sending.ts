import { randomUUID } from 'node:crypto'
import { herdr, type AgentInfo, type HerdrEvent } from './herdr.ts'
import { holdBack, machineNews } from './quiet.ts'
import { paneWrong, type Wrong } from './revive.ts'
import { sleep, type OutItem, type Hold, type SendOpts, type Sent } from './agents-helpers.ts'
import { isNews } from './agents-sent.ts'
import { putInto } from './agent-input.ts'
import { isRpcPane } from './agent-rpc.ts'
import { AgentsDelivery } from './agents-delivery.ts'

export class AgentsSending extends AgentsDelivery {
  private inflight = new Map<string, Promise<Sent>>()

  /** told when a pane needs its process compared: the news that revives is herdr's, nothing is polled for it */
  onSuspect?: () => void
  /** the pane each agent's process was last compared in: a new pane (a start, or herdr back) is compared once */
  private compared = new Map<string, string>()
  /** agents whose pane is to be compared: new, or its CLI exited */
  private due = new Set<string>()
  /** what the last compare found wrong with each agent's pane */
  private verdict = new Map<string, Wrong | undefined>()

  protected override take(list: AgentInfo[]) {
    super.take(list)
    for (const key of this.trackedKeys()) {
      const pane = this.info(key)?.pane_id
      if (!pane || isRpcPane(pane)) {
        this.compared.delete(key)
        this.verdict.delete(key)
        this.due.delete(key)
      } else if (this.compared.get(key) !== pane) {
        this.compared.set(key, pane)
        this.due.add(key)
      }
    }
    if (this.due.size) this.onSuspect?.()
  }

  protected override heard(e: HerdrEvent) {
    if (e.event === 'pane_exited') {
      const id = ((e.data.pane ?? e.data) as Partial<AgentInfo>).pane_id
      const key = this.trackedKeys().find((k) => this.info(k)?.pane_id === id)
      if (key) {
        this.due.add(key)
        this.onSuspect?.()
      }
      // the CLI ended, not the pane: it stays listed (its shell at the prompt) until herdr closes it or lists it otherwise
      return
    }
    super.heard(e)
  }

  /** whether any agent's pane waits for its compare */
  get suspects() {
    return this.due.size > 0
  }

  /** what is wrong with an agent's run: gone from herdr, or (see paneWrong) exited or on outdated files; null when herdr
   *  can't say. Asks herdr only for a pane not compared yet. Outdated files are left alone while it works or asks (a
   *  turn is never cut for this) */
  async wrong(key: string): Promise<Wrong | undefined | null> {
    const r = this.records[key]
    if (!r?.kind || this.rpcs.has(key)) return undefined
    const a = this.info(key)
    if (!a) return 'gone'
    if (this.due.has(key)) {
      const p = await herdr.processInfo(a.pane_id).catch(() => null)
      if (!p) return null
      this.due.delete(key)
      this.verdict.set(key, paneWrong(r.kind, p, this.filesOf(r)))
    }
    const w = this.verdict.get(key)
    return w === 'stale' && (a.agent_status === 'working' || a.agent_status === 'blocked') ? undefined : w
  }

  wasWorking(key: string) {
    return !!this.records[key]?.working
  }

  /** started again by `start` (that resumes its session), its pane closed first where it still holds it. Meanwhile what
   *  you send waits for the one it starts. It counts as stopping only while its pane closes: `start` goes through
   *  ensure(), which refuses a stopping one */
  async relaunch(key: string, close: boolean, start: () => Promise<unknown>) {
    this.unroute(key)
    this.stopping.add(key)
    try {
      const a = close ? this.info(key) : undefined
      if (a && this.rpcs.has(key)) await this.finish(key)
      else if (a) {
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

  /** why what you send would wait now, or nothing: it goes in at once. Typed text could pick an option on a menu, so it
   *  waits for the prompt to go; a starting agent takes no input yet; a CLI command waits for the turn to end. Anything
   *  else goes in even mid-turn: the CLI takes it at its next step. */
  holdOf(key: string, item?: Pick<OutItem, 'idle'>): Hold | undefined {
    return this.heldBy(key, item)
  }

  /** what you send: in at once, unless the agent is on a menu or still starting (see holdOf). What a screen sent (with its
   *  id) waits only that long: when the agent can't take it or won't start, the screen hears so and offers Retry. */
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

  protected async sendNow(key: string, text: string, { ensure, cid, idle, command }: SendOpts): Promise<Sent> {
    // before any herdr call: a done task has no pane, so a send would only end in "pane not found"
    const over = this.taskEnded?.(key)
    if (over) throw new Error(over)
    const base = { id: randomUUID(), key, text, at: Date.now(), ...(cid ? { cid } : {}) }
    // machine news is never a message to an agent (quiet.ts): rules and the status line carry it
    const news = machineNews(text)
    if (news) {
      holdBack(news, key)
      return { waiting: false, item: base }
    }
    if (isNews(cid) && this.sent.received(cid!)) return { waiting: false, item: { ...base, id: cid! } }
    const again = cid && this.outbox.find((o) => o.cid === cid)
    if (again) return { waiting: true, waitsFor: this.whyWaits(key), item: again }
    const done = cid && this.sent.withId(cid)
    if (done) return { waiting: false, item: done }
    if (cid) this.failures.clear(cid)
    const item: OutItem = { ...base, ...(idle ? { idle } : {}), ...(command ? { command } : {}) }
    if (this.unwanted(item)) return { waiting: false, item }
    if (this.status(key) === 'gone' && ensure && cid) {
      try {
        await ensure()
      } catch (e) {
        throw new Error(`The agent didn't start: ${(e as Error).message}`)
      }
      if (this.status(key) === 'gone') throw new Error(this.reachable ? "The agent isn't running." : "Can't reach herdr.")
    }
    await this.beforeInput?.(key)
    if (this.unwanted(item)) return { waiting: false, item }
    if (!this.holdOf(key, item) && !this.outbox.some((o) => o.key === key)) {
      try {
        const disposition = await putInto(this, key, item)
        this.went(item)
        this.emit('sent', item)
        return { waiting: false, item, ...(disposition ? { disposition } : {}) }
      } catch (e) {
        if (cid) throw new Error(`The agent didn't take it: ${(e as Error).message}`)
      }
    }
    this.outbox.push(item)
    this.save()
    if (this.status(key) === 'gone' && ensure)
      ensure()
        .then(() => this.deliver(key))
        .catch(() => undefined)
    else this.deliver(key)
    return { waiting: true, waitsFor: this.whyWaits(key), item }
  }

  /** why what waits for this agent waits: the first in line holds the rest */
  protected whyWaits(key: string) {
    const first = this.outbox.find((o) => o.key === key)
    return first ? this.holdOf(key, first) : undefined
  }

  failedLately(key: string) {
    return this.failures.lately(key)
  }

  waiting(key: string) {
    return this.outbox.filter((o) => o.key === key)
  }

  /** what went in with a screen's id in the last ten minutes, oldest first */
  sentLately(key: string) {
    return this.sent.lately(key)
  }

  typedSince(key: string, at: number) {
    return this.sent.since(key, at)
  }

  async keys(key: string, keys: string[]) {
    const a = this.info(key)
    if (a && !this.rpcs.has(key)) await herdr.paneKeys(a.pane_id, keys)
  }

  async text(key: string, text: string) {
    const a = this.info(key)
    if (a && !this.rpcs.has(key)) await herdr.paneText(a.pane_id, text)
  }

  /** a deleted task's agent, forgotten: its record (so its chat no longer reads its CLI's log) and what waited for it */
  forget(key: string) {
    this.unroute(key)
    const r = this.records[key]
    if (r) this.untrack(r)
    delete this.records[key]
    this.failures.forget(key)
    this.unstrand(key)
    this.dropWhere((o) => o.key === key)
    this.save()
  }

  /** a turn under way is interrupted, then given a few seconds to stop and write what it had; still at work after that,
   *  it throws and is left as it is */
  async stopTurn(key: string, ms = 15_000) {
    if (this.status(key) !== 'working') return
    await this.interrupt(key)
    for (const end = Date.now() + ms; this.status(key) === 'working'; ) {
      if (Date.now() > end) throw new Error('It is still working after an interrupt: try again in a moment.')
      await sleep(500)
      if (!this.rpcs.has(key)) await this.refresh()
    }
    await sleep(500) // what it wrote last reaches its log
  }

  async interrupt(key: string) {
    const rpc = this.rpcs.get(key)
    if (rpc) await rpc.abort()
    else if (this.info(key)) await herdr.sendKeys(this.records[key].name, ['esc']).catch(() => undefined)
  }
}
