import { chatProblem } from './readers/index.ts'
import { randomUUID } from 'node:crypto'
import { herdr, type AgentInfo } from './herdr.ts'
import { findPiLog } from './readers/find.ts'
import { chooseModel, firstModel } from '../../../src/models.ts'
import { putInto, typeIntoPane } from './agent-input.ts'
import { applySpec, findSpace, launchArgs, launchFiles, paneFor, startIn } from './agent-start.ts'
import * as task from './mfs.ts'
import { type AgentRecord, type Spec, holdFrom, hidden, sleep } from './agents-helpers.ts'
import { addLog } from './log-list.ts'
import { BOX } from './box.ts'
import { AgentsLink } from './agents-link.ts'
import { isNews } from './agents-sent.ts'
import { RpcAgent } from './agent-rpc.ts'

/** how soon a hand-over to an agent that is still starting is tried again */
const STARTING_RETRY_MS = 300

export class AgentsDelivery extends AgentsLink {
  private starting = new Map<string, Promise<AgentInfo | null>>()
  private delivering = new Set<string>()

  busy(key: string) {
    return this.starting.has(key) || this.stopping.has(key)
  }

  record(key: string) {
    return this.records[key]
  }

  routed(key: string) {
    return this.reachable && !!this.info(key)?.agent && !this.record(key)?.finished && this.hasRoute(key)
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
    if (running && this.rpcs.has(spec.key)) return Promise.resolve(running)
    if (running) return this.bindRoute({ ...this.records[spec.key], ...spec } as AgentRecord, running.pane_id).then(() => running)
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
    this.trackName(r)
    this.save()
    await task.mkdir(r.cwd, { recursive: true })
    const chosen = chooseModel(r.kind, r.model) ? firstModel(r.kind) : undefined
    if (chosen) r.model = chosen
    const unset = chooseModel(r.kind, r.model)
    if (unset) throw new Error(unset)
    const args = await this.args(r)
    if (input.rpc && r.kind === 'pi' && !BOX) return this.launchRpc(r, args, chosen, first)
    const pane = place ? await place() : await paneFor(r, was)
    this.startedIn.set(r.key, pane)
    this.save()
    await startIn(r, pane, args).catch((e) => {
      this.save()
      throw e
    })
    await this.refresh()
    await this.bindRoute(r, pane)
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

  /** the agent as a child of this server: its first record is read within moments, and the brief goes in with a prompt */
  private async launchRpc(r: AgentRecord, args: string[], chosen: string | undefined, first: string | undefined) {
    this.save()
    const rpc = new RpcAgent(
      args,
      { cwd: r.cwd, env: { ...process.env, ...r.env } },
      { change: () => this.rpcChanged(r.key), exit: (a) => this.rpcEnded(r.key, a) },
    )
    this.rpcs.set(r.key, rpc)
    try {
      await rpc.firstEvent
    } catch (e) {
      this.rpcs.delete(r.key)
      rpc.stop()
      r.finished = true
      this.save()
      throw e
    }
    await this.bindRoutePid(r, rpc.pid)
    this.queue(
      r.key,
      [chosen ? hidden(`No model was set, so the machine's first available model was chosen: ${chosen}. Note it in your facts.`) : '', first ?? ''].filter(
        Boolean,
      ),
      true,
      true,
    )
    this.rpcChanged(r.key)
    void this.deliver(r.key)
    return this.live.get(r.name) ?? null
  }

  /** the agent's own status and session, as its events say them */
  private rpcChanged(key: string) {
    const rpc = this.rpcs.get(key)
    const r = this.records[key]
    if (!rpc || !r) return
    this.live.set(r.name, this.rpcInfo(r, rpc))
    this.settle()
  }

  private rpcEnded(key: string, rpc: RpcAgent) {
    if (this.rpcs.get(key) !== rpc) return
    this.rpcs.delete(key)
    const r = this.records[key]
    if (r) this.live.delete(r.name)
    this.settle()
  }

  args = launchArgs
  filesOf = launchFiles
  space = findSpace

  /** hand over what waited, oldest first, while the agent can take it */
  async deliver(key: string): Promise<void> {
    if (this.delivering.has(key) || Date.now() < (this.backoff.get(key)?.until ?? 0)) return
    this.delivering.add(key)
    try {
      for (;;) {
        const next = this.outbox.find((o) => o.key === key)
        if (!next) return void this.unready.delete(key)
        const drop = () => this.dropWhere((o) => o === next)
        if (this.unwanted(next) || (isNews(next.cid) && this.sent.received(next.cid!))) {
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
        if (this.rpcs.has(key)) continue
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
    const rpc = this.rpcs.get(key)
    if (rpc) {
      this.rpcEnded(key, rpc)
      return rpc.stop()
    }
    if (!a) return
    const close = herdr.closePane(a.pane_id)
    await (strict ? close : close.catch(() => undefined))
    await this.refresh() // gone from what herdr runs at once, so starting it again starts a new one
  }
}
