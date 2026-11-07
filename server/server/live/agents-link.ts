import { herdr, paneEvents, Subscription, type AgentInfo, type AgentStatus, type HerdrEvent } from './herdr.ts'
import { LinkBackoff } from './recovery.ts'
import { PasteWatch } from './paste-watch.ts'
import { AgentTerminals } from './agent-terminals.ts'
import { listAfter } from './agent-events.ts'
import { BOX } from './box.ts'
import { AgentsState } from './agents-state.ts'
import type { AgentHerdr, TermScreen } from '../../shared/types.ts'

/** The link to herdr: the session read on open and when the subscription drops, the events between, and what follows from
 *  the agents herdr lists. What goes into a pane is the delivery's job. */
export abstract class AgentsLink extends AgentsState {
  private timer: ReturnType<typeof setInterval> | null = null
  private sub: Subscription
  private refreshing = false
  private readAgain = false
  /** the subscription dropped and has not opened again: a read meanwhile does not make herdr reachable */
  private subDown = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  /** every agent herdr listed, named or not: events keep it current between reads */
  private listed: AgentInfo[] = []
  private pasteDue = new Set<string>()
  private paste = new PasteWatch()
  private heardAt = 0
  private halted = false
  private retryAt = 0
  private recovery = new LinkBackoff()
  private told = new Map<string, AgentStatus | 'gone'>()
  private terminals = new AgentTerminals(
    (k) => this.info(k),
    (k, s) => this.emit('output', k, s),
    (k) => this.screen(k), // by name, so a subclass or a test can replace screen
  )

  /** hands over what waited for this agent, while it can take it */
  abstract deliver(key: string): Promise<void>

  constructor() {
    super()
    // status and pane changes arrive as events; the session is read once it opens and when it drops and reopens
    this.sub = new Subscription(
      (e) => this.heard(e),
      (planned) => {
        this.subDown = false
        if (!planned || !this.reachable) void this.refresh(true)
      },
      undefined,
      () => {
        this.subDown = true
        if (this.halted || !this.reachable) return
        this.reachable = false
        this.emit('status', '*', 'gone')
      },
    )
  }

  get stopped() {
    return this.halted
  }

  start() {
    this.refresh()
    // upkeep of what herdr does not push (stranded sends, expiry); the open subscription is herdr's contact
    this.timer = setInterval(() => {
      if (this.reachable) this.lastReach = Date.now()
      this.settle()
    }, 2000)
  }

  stop() {
    this.halted = true
    for (const rpc of this.rpcs.values()) rpc.stop()
    if (this.timer) clearInterval(this.timer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.terminals.stop()
    this.paste.stop()
    this.sub.stop()
  }

  /** herdr's word on the agent as the events and reads kept it: nothing is asked of herdr */
  herdrView(key: string): AgentHerdr | undefined {
    const a = this.info(key)
    const s = a?.agent_session
    return a && { status: a.agent_status, ...(s?.kind === 'path' ? { session: s.value } : {}), pasted: this.paste.has(key), at: this.heardAt }
  }

  screen(key: string): Promise<TermScreen> {
    return this.terminals.screen(key)
  }

  watchTerminals(keys: string[]) {
    this.terminals.watch(keys)
  }

  /** herdr's session read whole: on open, on a lost or reopened subscription, and where a send or a start needs the new
   *  state at once. `force` follows an event: not held back by a retry wait, and read again after one in flight */
  async refresh(force = false) {
    if (this.stopped || (BOX && !force && Date.now() < this.retryAt)) return
    if (this.refreshing) {
      if (force) this.readAgain = true
      return
    }
    this.refreshing = true
    try {
      const list = await herdr.snapshot()
      if (this.stopped) return
      if (!this.reachable && BOX) console.info('lineclear: herdr link recovered')
      this.recovery.success()
      this.retryAt = 0
      this.reachable = !this.subDown
      this.lastReach = Date.now()
      this.take(list)
    } catch {
      const wait = this.recovery.fail()
      if (BOX) this.retryAt = Date.now() + wait
      if (this.reachable) {
        if (BOX) console.info('lineclear: herdr link lost; retrying (3-30s backoff)')
        this.reachable = false
        this.emit('status', '*', 'gone')
      }
      this.checkStranded()
      if (this.retryTimer) clearTimeout(this.retryTimer)
      this.retryTimer = setTimeout(() => void this.refresh(true), wait)
    } finally {
      this.refreshing = false
      if (this.readAgain && !this.stopped) {
        this.readAgain = false
        void this.refresh(true)
      }
    }
  }

  protected take(list: AgentInfo[]) {
    this.listed = list
    this.heardAt = Date.now()
    this.live = new Map(list.filter((a) => a.name).map((a) => [a.name!, a]))
    for (const [key, a] of this.rpcs) if (this.records[key]) this.live.set(this.records[key].name, this.rpcInfo(this.records[key], a))
    this.settle()
    void this.repairRoutes()
    this.sub.set(paneEvents(list.map((x) => x.pane_id)))
  }

  /** one event of the subscription (agent-events.ts): kept as it came, or read from herdr, which alone says a new agent's name */
  protected heard(e: HerdrEvent) {
    if (this.refreshing) this.readAgain = true
    const next = listAfter(this.listed, e)
    if (next === 'read') void this.refresh(true)
    else if (next) this.take(next)
  }

  /** everything that follows from the agents herdr listed and what their files say; never asks herdr for them again */
  protected settle() {
    if (this.stopped) return
    // herdr lists an agent it just started without its name: given back, or nothing that waits for it ever goes in
    for (const a of this.listed.filter((a) => !a.name)) {
      const r = Object.values(this.records).find((r) => !r.finished && !this.live.has(r.name) && this.startedIn.get(r.key) === a.pane_id)
      if (r) herdr.rename(a.pane_id, r.name).catch(() => undefined)
    }
    for (const key of this.trackedKeys()) {
      const now = this.status(key)
      const was = this.told.get(key) ?? 'gone'
      this.told.set(key, now)
      if (was === now) continue
      this.pasteDue.add(key)
      this.changed(key, now, was)
    }
    for (const r of Object.values(this.records)) if (!this.live.has(r.name) || r.finished) this.unroute(r.key)
    this.lookAtPastes()
    for (const [name, key] of this.trackedNames()) this.learnSession(key, this.live.get(name))
    for (const key of new Set(this.outbox.map((o) => o.key))) if (!this.heldBy(key)) this.deliver(key)
    this.checkStranded()
  }

  protected changed(key: string, status: AgentStatus | 'gone', was: AgentStatus | 'gone' = 'gone') {
    const r = this.records[key]
    // a first look after Lineclear started (was gone) must not wipe what was saved: a restored pane shows idle
    if (r && status !== 'gone' && status !== 'blocked' && (status === 'working' || was !== 'gone') && !!r.working !== (status === 'working')) {
      r.working = status === 'working'
      this.save()
    }
    this.emit('status', key, status)
    if (status !== 'gone' && status !== 'blocked') this.deliver(key)
    if (status !== 'gone') this.emit('logs', key)
  }

  private lookAtPastes() {
    for (const key of this.trackedKeys()) {
      if (this.halted) return
      if (this.pasteDue.delete(key) && !this.rpcs.has(key)) void this.paste.look(key, this.records[key]?.started ?? 0, () => this.info(key)?.pane_id)
    }
  }
}
