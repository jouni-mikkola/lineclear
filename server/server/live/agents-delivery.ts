import { chatProblem } from './readers/index.ts'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { herdr, paneEvents, type AgentInfo, type AgentStatus, type HerdrEvent } from './herdr.ts'
import { findLog, logKind } from './readers/find.ts'
import { chooseModel, effortFor, firstModel, modelArg } from '../../../src/models.ts'
import * as task from './mfs.ts'
import { agentEnv, BOX } from './box.ts'
import { ROOT } from '../root.ts'
import { type AgentRecord, type Spec, holdFrom, ownOldPane, promptPath, hidden } from './agents-helpers.ts'
import { addLog } from './log-list.ts'
import { AgentsState } from './agents-state.ts'
import { listAfter } from './agent-events.ts'

/** a launch's spec onto its record: what it leaves unsaid stays as the record had it */
function applySpec(r: AgentRecord, spec: Omit<Spec, 'first' | 'pane' | 'was' | 'fresh'>) {
  Object.assign(r, {
    name: spec.name,
    kind: spec.kind,
    cwd: spec.cwd,
    workspace: spec.workspace,
    tab: spec.tab ?? r.tab,
    env: spec.env ?? r.env,
    access: spec.access ?? r.access,
    model: spec.model ?? r.model,
    effort: spec.effort ?? r.effort,
    system: spec.system ?? r.system,
    set: spec.set ?? r.set,
    finished: false,
  })
}

/** how soon a hand-over to an agent that is still starting is tried again */
const STARTING_RETRY_MS = 300

export class AgentsDelivery extends AgentsState {
  pauseDelivery(key: string, on: boolean) {
    if (on) this.deliveryPaused.add(key)
    else {
      this.deliveryPaused.delete(key)
      void this.deliver(key)
    }
  }
  prepare?: (spec: Spec) => Promise<Spec>
  launchAllowed?: (spec: Spec) => void

  start() {
    this.refresh()
    // upkeep of what herdr does not push: files of codex runs, stranded sends, background expiry.
    // It never asks herdr for anything.
    this.timer = setInterval(() => {
      // the subscription is open while herdr is reachable: that is its contact
      if (this.reachable) this.lastReach = Date.now()
      this.settle()
    }, 2000)
  }

  stop() {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.terminalClock.stop()
    this.paste.stop()
    this.sub.stop()
  }

  record(key: string) {
    return this.records[key]
  }

  /** Private routing was bound to this session's actual CLI process. */
  routed(key: string) {
    return this.reachable && !!this.info(key)?.agent && !this.record(key)?.finished && this.routes.has(key)
  }

  /** a name herdr accepts: [a-z][a-z0-9_-]{0,31} */
  static nameFor(s: string) {
    const n = s
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^[^a-z]+/, '')
      .slice(0, 32)
      .replace(/-+$/, '')
    return n || `shep-${randomUUID().slice(0, 6)}`
  }

  /* ---------- herdr state ---------- */

  /** herdr's session read whole: on open, on a lost or reopened subscription, and where a send or a start needs the
   *  new state at once. `force` is a call that follows an event: it is not held back by a retry wait, and one that comes
   *  while a read is in flight reads again after it */
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
      this.retryAfter(wait)
    } finally {
      this.refreshing = false
      if (this.readAgain && !this.stopped) {
        this.readAgain = false
        void this.refresh(true)
      }
    }
  }

  /** nothing else asks again while no subscription is open */
  protected retryAfter(ms: number) {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => void this.refresh(true), ms)
  }

  protected take(list: AgentInfo[]) {
    this.listed = list
    this.heardAt = Date.now()
    this.live = new Map(list.filter((a) => a.name).map((a) => [a.name!, a]))
    this.settle()
    void this.repairRoutes()
    this.sub.set(paneEvents(list.map((x) => x.pane_id)))
  }

  /** what one event of the subscription says (agent-events.ts): kept as it came, or read from herdr, which alone says
   *  the name of a new agent */
  protected heard(e: HerdrEvent) {
    // an event while the session is being read may predate it or not: read again after
    if (this.refreshing) this.readAgain = true
    const next = listAfter(this.listed, e)
    if (next === 'read') void this.refresh(true)
    else if (next) this.take(next)
  }

  /** everything that follows from the agents herdr listed and what their files say; never asks herdr for them again */
  protected settle() {
    if (this.stopped) return
    const list = this.listed
    // herdr lists an agent it just started without its name: given back, or nothing that waits for it ever goes in
    for (const a of list.filter((a) => !a.name)) {
      const r = Object.values(this.records).find((r) => !r.finished && !this.live.has(r.name) && this.startedIn.get(r.key) === a.pane_id)
      if (r) herdr.rename(a.pane_id, r.name).catch(() => undefined)
    }
    for (const key of this.byName.values()) {
      const now = this.status(key)
      const was = this.told.get(key) ?? 'gone'
      this.told.set(key, now)
      if (was !== now) {
        this.pasteDue.add(key)
        this.changed(key, now, was)
      }
    }
    for (const r of Object.values(this.records)) {
      if (!this.live.has(r.name) || r.finished) {
        this.secretAccess.revoke(r.key)
        this.routes.delete(r.key)
      }
    }
    this.lookAtPastes()
    // learn log files herdr names (its agent integrations report them)
    for (const [name, key] of this.byName) this.learnSession(key, this.live.get(name))
    // what waits goes in as soon as its agent can take it
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

  /** after a command that may start another session (/new, /clear, /resume), : its
   *  CLI's newest log changed since then, once it is one the chat doesn't read yet */
  follow(key: string, since: number) {
    const r = this.records[key]
    if (!r) return
    const look = () => {
      const f = findLog(r.kind, r.cwd, since - 1000)
      if (!f || !addLog(r, f)) return
      // pi resumes by the id in its name; Codex by its last log
      if (r.kind !== 'codex') r.sessionId = f.match(/([0-9a-f-]{36})\.jsonl$/)?.[1] ?? r.sessionId
      this.save()
      this.emit('logs', key)
    }
    // a menu it opened (Codex's /new asks where) may be answered a while later
    for (const ms of [1500, 5000, 15000, 60000, 180000]) setTimeout(look, ms)
  }

  /** an agent already running in herdr that Lineclear should treat as this chat */
  adopt(key: string, a: AgentInfo, kind: string, workspace: string) {
    if (this.records[key]?.name === a.name) return
    this.records[key] = { key, name: a.name!, kind, cwd: a.cwd ?? '', workspace, logs: [], started: Date.now() }
    this.byName.set(a.name!, key)
    this.learnSession(key, a)
    this.save()
  }

  /* ---------- starting ---------- */

  /**
   * Start this chat's agent again on what spec says: `before` first (its turn stopped; what it returns is the first
   * message then, read once the turn is over), then its run ends and it starts, resuming its session on the same CLI.
   * Meanwhile anything that would start it waits for this instead, and what you send waits and goes in after the first
   * message. `before` throwing leaves it as it was.
   */
  restart(spec: Spec, before?: () => Promise<string | void>): Promise<AgentInfo | null> {
    const problem = chatProblem(spec.kind)
    if (problem) return Promise.reject(new Error(problem))
    const p0 = this.starting.get(spec.key)
    const p = (async () => {
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
    })().finally(() => this.starting.delete(spec.key))
    this.starting.set(spec.key, p)
    return p
  }

  /** start (or resume) this chat's agent; resolves once herdr says it is ready for input */
  ensure(spec: Spec): Promise<AgentInfo | null> {
    const problem = chatProblem(spec.kind)
    if (problem) return Promise.reject(new Error(problem))
    if (this.stopping.has(spec.key)) return this.starting.get(spec.key) ?? Promise.reject(new Error('Coordinator transition in progress.'))
    this.launchAllowed?.(spec)
    const running = this.live.get(spec.name)
    if (running) return this.bindRoute({ ...this.records[spec.key], ...spec } as AgentRecord, running.pane_id).then(() => running)
    const p0 = this.starting.get(spec.key)
    if (p0) return p0
    const p = this.launch(spec).finally(() => this.starting.delete(spec.key))
    this.starting.set(spec.key, p)
    return p
  }

  protected async launch(input: Spec) {
    this.launchAllowed?.(input)
    const { first, pane: place, was, fresh, ...spec } = await (this.prepare?.(input) ?? input)
    this.secretAccess.revoke(spec.key)
    this.routes.delete(spec.key)
    const old = this.records[spec.key]
    const resume = !fresh && old && old.kind === spec.kind && !!(old.sessionId || old.logs.length)
    const lost = !fresh && !!old && old.kind === spec.kind && !resume && !!(old.sessionId || old.logs.length)
    const r: AgentRecord = old ?? { ...spec, logs: [], started: Date.now() }
    const changedPrompt = old?.system !== spec.system
    if (fresh) {
      r.model = ''
      r.effort = ''
    }
    applySpec(r, spec)
    r.launch = randomUUID()
    if (fresh) this.outbox = this.outbox.filter((item) => item.key !== spec.key || item.cid || !item.text.startsWith('<lineclear>'))
    r.started = Date.now()
    if (!resume) r.sessionId = r.kind === 'codex' ? undefined : randomUUID()
    this.records[spec.key] = r
    this.byName.set(r.name, r.key)
    this.save()
    task.mkdirSync(r.cwd, { recursive: true })
    // no model set: the machine's first one, noted so the task's facts say it
    const first = chooseModel(r.kind, r.model) ? firstModel(r.kind) : undefined
    if (first) {
      r.model = first
      r.chosenModel = first
    }
    const unset = chooseModel(r.kind, r.model)
    if (unset) throw new Error(unset)
    const pane = place ? await place() : await this.paneFor(r, was)
    this.startedIn.set(r.key, pane)
    const args = this.args(r, !!resume)
    this.save()
    // a new pane needs a moment before its shell is at the prompt
    for (let i = 0; ; i++) {
      try {
        await herdr.start(r.name, r.kind, pane, args)
        break
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code === 'agent_not_ready') break
        // the agent's own earlier pane (Done, still open) holds its name: closed, then started again
        const old = ownOldPane(e, await herdr.agents().catch(() => []), r.name, pane)
        if (old) {
          await herdr.closePane(old).catch(() => undefined)
          continue
        }
        if (i >= 8) {
          console.error(`lineclear: could not start ${r.name}: ${(e as Error).message}`)
          r.finished = true
          this.save()
          await herdr.closePane(pane).catch(() => undefined)
          throw e
        }
        await new Promise((res) => setTimeout(res, 750))
      }
    }
    await this.refresh()
    await this.bindRoute(r, pane)
    // CLIs without an option for extra instructions get them first, hidden from the chat. Both wait until the CLI is
    // ready, ahead of what you sent meanwhile (a restart)
    this.queue(
      r.key,
      [
        r.kind !== 'pi' && (!resume || changedPrompt) && r.system ? hidden(r.system) : '',
        lost ? hidden('Your earlier conversation could not be resumed. Read your brief and your branch, then carry on from where you were.') : '',
        first ?? '',
      ].filter(Boolean),
      true,
      true,
    )
    setTimeout(() => this.deliver(r.key), 250)
    setTimeout(() => this.discoverLog(r.key), 3000)
    setTimeout(() => this.discoverLog(r.key), 15000)
    return this.live.get(r.name) ?? null
  }

  args(r: AgentRecord, resume: boolean): string[] {
    const a: string[] = []
    // a model is kept by its id, or by its name when picked in the chat's menu (Model Top 5.5); an effort its model lacks
    // goes in as the nearest it has
    const model = modelArg(r.kind, r.model)
    const effort = effortFor(r.kind, r.effort, r.model)
    if (r.kind === 'pi') {
      if (r.sessionId) a.push('--session-id', r.sessionId)
      if (r.system) a.push('--append-system-prompt', this.promptFile(r))
      if (model) a.push('--model', model)
      if (effort) a.push('--thinking', effort)
    } else if (r.kind === 'codex') {
      // Codex tools have their own environment policy. Set the owner explicitly even on resume;
      // do not depend on the pane's login shell or its stale inherited environment.
      const env = { ...r.env, ...agentEnv(r.key, ROOT) }
      a.push(
        '-c',
        `shell_environment_policy.set={${Object.entries(env)
          .map(([k, v]) => `${JSON.stringify(k)}=${JSON.stringify(v)}`)
          .join(',')}}`,
      )
      // its own last log: a task it took over keeps the logs of the agent before it too
      const id = resume
        ? r.logs.findLast((f) => (logKind(f) ?? 'codex') === 'codex')?.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)?.[1]
        : undefined
      if (id) a.unshift('resume', id)
      if (r.access !== 'ask') a.push('--dangerously-bypass-approvals-and-sandbox')
      if (model) a.push('-m', model)
      if (effort) a.push('-c', `model_reasoning_effort="${effort}"`)
    }
    return a
  }

  /** instructions go in a file: long text with quotes and newlines can't travel as a shell argument */
  protected promptFile(r: AgentRecord) {
    const f = promptPath(r.name)
    task.mkdirSync(dirname(f), { recursive: true })
    task.writeFileSync(f, r.system ?? '')
    return f
  }

  /** the files Lineclear starts its CLI with now, by flag: its instructions. One started with others (herdr restored
   *  an older command after it restarted) runs without them */
  filesOf(r: AgentRecord): Record<string, string> {
    if (r.kind === 'pi' && r.system) return { '--append-system-prompt': promptPath(r.name) }
    return {}
  }

  /** the workspace labelled so, or the one still labelled `was` (never a repo's), renamed to it */
  async space(label: string, was?: string) {
    const list = await herdr.workspaces()
    const ws = list.find((w) => w.label === label)
    const old = !ws && was ? list.find((w) => w.label === was && !w.worktree) : undefined
    if (old) await herdr.renameWorkspace(old.workspace_id, label)
    return ws ?? old
  }

  protected async paneFor(r: AgentRecord, was?: string): Promise<string> {
    const env = r.env ?? {}
    const ws = await this.space(r.workspace, was)
    if (!ws) return (await herdr.createWorkspace(r.workspace, r.cwd, env)).root_pane.pane_id
    const tab = r.tab ?? r.name
    // a coordinator is one per space: its earlier tabs (dead, or restored by herdr after a restart) go when it starts again.
    // A tab with a split, a running command or an agent is the human's, and stays
    const older = tab === 'coordinator' ? await herdr.tabs(ws.workspace_id).catch(() => []) : []
    const made = await herdr.createTab(ws.workspace_id, tab, r.cwd, env)
    const gone = older.filter((t) => t.label === tab && t.tab_id !== made.tab?.tab_id && (t.pane_count ?? 1) === 1)
    if (gone.length) {
      const [panes, agents] = await Promise.all([herdr.panes(ws.workspace_id), herdr.agents()]).catch(() => [[], []] as const)
      for (const t of gone)
        for (const p of panes.filter((p) => p.tab_id === t.tab_id && !agents.some((a) => a.pane_id === p.pane_id)))
          if (await herdr.paneIdle(p.pane_id).catch(() => false)) await herdr.closePane(p.pane_id).catch(() => undefined)
    }
    return made.root_pane.pane_id
  }

  /** hand over what waited, oldest first, while the agent can take it */
  async deliver(key: string) {
    if (this.delivering.has(key) || Date.now() < (this.backoff.get(key)?.until ?? 0)) return
    this.delivering.add(key)
    try {
      for (;;) {
        const next = this.outbox.find((o) => o.key === key)
        if (!next) return void this.unready.delete(key)
        const unwanted = () => (next.launch && next.launch !== this.records[key]?.launch) || (this.acceptInput && !this.acceptInput(next))
        const drop = () => {
          this.outbox = this.outbox.filter((o) => o !== next)
          this.save()
        }
        if (unwanted() || (next.cid?.startsWith('requested-news:') && this.newsReceipts.includes(next.cid))) {
          drop()
          continue
        }
        await this.beforeInput?.(key)
        if (unwanted()) {
          drop()
          continue
        }
        if (this.heldBy(key, next)) return
        try {
          await this.put(key, next)
        } catch (e) {
          if (!(await this.typeIntoPane(key, next, e))) throw e
        }
        this.backoff.delete(key)
        this.unready.delete(key)
        this.went(next)
        this.outbox = this.outbox.filter((o) => o !== next)
        this.save()
        this.emit('sent', next)
        // give the CLI a moment to take it before the next item
        await new Promise((r) => setTimeout(r, 1500))
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
    // a menu came up just now: it goes in once the menu is gone
    const hold = holdFrom(e)
    if (hold === 'menu') return
    const n = (this.backoff.get(key)?.n ?? 0) + 1
    // an agent still starting is asked again soon: a long backoff there is most of a new task's start time
    const wait = hold === 'start' ? Math.min(this.backoffMs, STARTING_RETRY_MS) : Math.min(this.backoffMs * 2 ** (n - 1), this.backoffMax)
    this.backoff.set(key, { n, until: Date.now() + wait })
    this.giveUpOnBriefs(key)
    // just started, not herdr's named agent yet: tried again shortly, for a while
    if (hold === 'start') {
      const since = this.unready.get(key) ?? Date.now()
      this.unready.set(key, since)
      if (Date.now() - since < this.unreadyFor) {
        const retry = setTimeout(() => void (!this.stopped && this.deliver(key)), wait + 10)
        retry.unref?.()
        return
      }
      this.unready.delete(key)
    }
    this.backoff.delete(key)
    // tried again on the next status change; what a screen sent fails now, so it doesn't wait on an agent that can't
    // take it
    this.fail(key, `The agent didn't take it: ${(e as Error).message}`)
  }

  /** ahead: before what waits for this agent already */
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
    this.secretAccess.revoke(key)
    this.routes.delete(key)
    const r = this.records[key]
    const a = this.info(key)
    if (r) r.finished = true
    this.save()
    if (!a) return
    if (strict) await herdr.closePane(a.pane_id)
    else await herdr.closePane(a.pane_id).catch(() => undefined)
    // gone from what herdr runs at once: starting it again (a backup agent taking over) starts a new one
    await this.refresh()
  }
}
