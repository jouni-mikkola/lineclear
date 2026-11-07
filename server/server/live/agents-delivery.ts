import { chatProblem } from './readers/index.ts'
import { randomUUID } from 'node:crypto'
import { herdr, paneEvents, type AgentInfo, type AgentStatus, type HerdrEvent } from './herdr.ts'
import { findPiLog } from './readers/find.ts'
import { chooseModel, firstModel } from '../../../src/models.ts'
import { putInto, typeIntoPane } from './agent-input.ts'
import { applySpec, findSpace, launchArgs, launchFiles, paneFor, startIn } from './agent-start.ts'
import * as task from './mfs.ts'
import { BOX } from './box.ts'
import { type AgentRecord, type Spec, holdFrom, hidden, sleep } from './agents-helpers.ts'
import { addLog } from './log-list.ts'
import { AgentsState, isNews } from './agents-state.ts'
import { listAfter } from './agent-events.ts'

/** how soon a hand-over to an agent that is still starting is tried again */
const STARTING_RETRY_MS = 300

export class AgentsDelivery extends AgentsState {
  start() {
    this.refresh()
    // upkeep of what herdr does not push (stranded sends, expiry); the open subscription is herdr's contact
    this.timer = setInterval(() => {
      if (this.reachable) this.lastReach = Date.now()
      this.settle()
    }, 2000)
  }

  stop() {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.terminals.stop()
    this.paste.stop()
    this.sub.stop()
  }

  record(key: string) {
    return this.records[key]
  }

  routed(key: string) {
    return this.reachable && !!this.info(key)?.agent && !this.record(key)?.finished && this.routes.has(key)
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
    this.settle()
    void this.routes.repair()
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
    for (const key of this.byName.values()) {
      const now = this.status(key)
      const was = this.told.get(key) ?? 'gone'
      this.told.set(key, now)
      if (was === now) continue
      this.pasteDue.add(key)
      this.changed(key, now, was)
    }
    for (const r of Object.values(this.records)) if (!this.live.has(r.name) || r.finished) this.unroute(r.key)
    this.lookAtPastes()
    for (const [name, key] of this.byName) this.learnSession(key, this.live.get(name))
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

  /** after a command that may start another session (/new, /clear, /resume): its CLI's newest log since then; a menu it
   *  opened may be answered a while later */
  follow(key: string, since: number) {
    const r = this.records[key]
    if (!r) return
    const look = () => {
      const f = r.kind === 'pi' ? findPiLog(r.cwd, since - 1000) : undefined
      if (!f || !addLog(r, f)) return
      r.sessionId = f.match(/([0-9a-f-]{36})\.jsonl$/)?.[1] ?? r.sessionId
      this.save()
      this.emit('logs', key)
    }
    for (const ms of [1500, 5000, 15000, 60000, 180000]) setTimeout(look, ms)
  }

  private starts(key: string, go: () => Promise<AgentInfo | null>) {
    const p = go().finally(() => this.starting.delete(key))
    this.starting.set(key, p)
    return p
  }

  /** Start this chat's agent again on what spec says: `before` first (its turn stopped; what it returns is the first
   *  message then), then its run ends and it starts, resuming its session. Meanwhile whatever would start it waits for this
   *  and what you send goes in after the first message. `before` throwing leaves it as it was. */
  restart(spec: Spec, before?: () => Promise<string | void>): Promise<AgentInfo | null> {
    const problem = chatProblem(spec.kind)
    if (problem) return Promise.reject(new Error(problem))
    const p0 = this.starting.get(spec.key)
    return this.starts(spec.key, async () => {
      await p0?.catch(() => undefined)
      this.stopping.add(spec.key)
      try {
        const first = await before?.()
        await this.finish(spec.key, true)
        return await this.launch({ ...spec, ...(first ? { first } : {}) })
      } finally {
        this.stopping.delete(spec.key)
        this.deliver(spec.key)
      }
    })
  }

  /** start (or resume) this chat's agent; resolves once herdr says it is ready for input */
  ensure(spec: Spec): Promise<AgentInfo | null> {
    const problem = chatProblem(spec.kind)
    if (problem) return Promise.reject(new Error(problem))
    if (this.stopping.has(spec.key)) return this.starting.get(spec.key) ?? Promise.reject(new Error('Coordinator transition in progress.'))
    const running = this.live.get(spec.name)
    if (running) return this.routes.bind({ ...this.records[spec.key], ...spec } as AgentRecord, running.pane_id).then(() => running)
    return this.starting.get(spec.key) ?? this.starts(spec.key, () => this.launch(spec))
  }

  protected async launch(input: Spec) {
    const { first, pane: place, was, fresh, ...spec } = input
    this.unroute(spec.key)
    const old = this.records[spec.key]
    const resume = !fresh && old && old.kind === spec.kind && !!(old.sessionId || old.logs.length)
    const r: AgentRecord = old ?? { ...spec, logs: [], started: Date.now() }
    if (fresh) r.model = r.effort = ''
    applySpec(r, spec)
    if (fresh) this.outbox = this.outbox.filter((item) => item.key !== spec.key || item.cid || !item.text.startsWith('<lineclear>'))
    if (!resume) r.sessionId = randomUUID()
    this.records[spec.key] = r
    this.byName.set(r.name, r.key)
    this.save()
    task.mkdirSync(r.cwd, { recursive: true })
    const chosen = chooseModel(r.kind, r.model) ? firstModel(r.kind) : undefined
    if (chosen) r.model = chosen
    const unset = chooseModel(r.kind, r.model)
    if (unset) throw new Error(unset)
    const pane = place ? await place() : await paneFor(r, was)
    this.startedIn.set(r.key, pane)
    const args = this.args(r)
    this.save()
    await startIn(r, pane, args).catch((e) => {
      this.save()
      throw e
    })
    await this.refresh()
    await this.routes.bind(r, pane)
    // the brief waits until the CLI is ready, ahead of what you sent meanwhile (a restart)
    this.queue(
      r.key,
      [chosen ? hidden(`No model was set, so the machine's first available model was chosen: ${chosen}. Note it in your facts.`) : '', first ?? ''].filter(
        Boolean,
      ),
      true,
      true,
    )
    setTimeout(() => this.deliver(r.key), 250)
    for (const ms of [3000, 15000]) setTimeout(() => this.discoverLog(r.key), ms)
    return this.live.get(r.name) ?? null
  }

  args = launchArgs
  filesOf = launchFiles
  space = findSpace

  /** hand over what waited, oldest first, while the agent can take it */
  async deliver(key: string) {
    if (this.delivering.has(key) || Date.now() < (this.backoff.get(key)?.until ?? 0)) return
    this.delivering.add(key)
    try {
      for (;;) {
        const next = this.outbox.find((o) => o.key === key)
        if (!next) return void this.unready.delete(key)
        const drop = () => this.dropWhere((o) => o === next)
        if (this.unwanted(next) || (isNews(next.cid) && this.newsReceipts.includes(next.cid!))) {
          drop()
          continue
        }
        await this.beforeInput?.(key)
        if (this.unwanted(next)) {
          drop()
          continue
        }
        if (this.heldBy(key, next)) return
        try {
          await putInto(this, key, next)
        } catch (e) {
          if (!(await typeIntoPane(this, key, next, e))) throw e
        }
        this.backoff.delete(key)
        this.unready.delete(key)
        this.went(next)
        drop()
        this.emit('sent', next)
        await sleep(1500) // the CLI takes it before the next item
        await this.refresh()
      }
    } catch (e) {
      this.deliveryFailed(key, e)
    } finally {
      this.delivering.delete(key)
    }
  }

  /** a hand-over failed: backed off, and given up on once it can't be waited for */
  protected deliveryFailed(key: string, e: unknown) {
    const hold = holdFrom(e)
    if (hold === 'menu') return // it goes in once the menu is gone
    const n = (this.backoff.get(key)?.n ?? 0) + 1
    // an agent still starting is asked again soon: a long backoff there is most of a new task's start time
    const wait = hold === 'start' ? Math.min(this.backoffMs, STARTING_RETRY_MS) : Math.min(this.backoffMs * 2 ** (n - 1), this.backoffMax)
    this.backoff.set(key, { n, until: Date.now() + wait })
    this.giveUpOnBriefs(key)
    if (hold === 'start') {
      const since = this.unready.get(key) ?? Date.now()
      this.unready.set(key, since)
      if (Date.now() - since < this.unreadyFor) {
        setTimeout(() => void (!this.stopped && this.deliver(key)), wait + 10).unref?.()
        return
      }
      this.unready.delete(key)
    }
    this.backoff.delete(key)
    // what a screen sent fails now; the rest is tried on the next status change
    this.fail(key, `The agent didn't take it: ${(e as Error).message}`)
  }

  protected queue(key: string, texts: string[], ahead = false, brief = false) {
    if (!texts.length) return
    const items = texts.map((text) => ({ launch: this.records[key]?.launch, id: randomUUID(), key, text, at: Date.now(), ...(brief ? { brief } : {}) }))
    const i = ahead ? this.outbox.findIndex((o) => o.key === key) : -1
    if (i < 0) this.outbox.push(...items)
    else this.outbox.splice(i, 0, ...items)
    this.save()
  }

  /** end a task agent's run: its pane closes; its chat stays and writing to it resumes it */
  async finish(key: string, strict = false) {
    this.unroute(key)
    const a = this.info(key)
    if (this.records[key]) this.records[key].finished = true
    this.save()
    if (!a) return
    const close = herdr.closePane(a.pane_id)
    await (strict ? close : close.catch(() => undefined))
    await this.refresh() // gone from what herdr runs at once, so starting it again starts a new one
  }
}
