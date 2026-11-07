import { chooseModel } from './models.ts'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { sortPlaces } from '../../shared/order.ts'
import { clock } from '../../shared/time.ts'
import { slugify, type Alert, type Machine, type Place, type Section } from '../../shared/types.ts'
import { Emitter, type SourceEvents } from '../source.ts'
import { HOME, readJson, writeJson } from '../store.ts'
import { ROOT } from '../root.ts'
import { wrapPage } from '../frame.ts'
import { Agents, hidden, type Spec } from './agents.ts'
import { Automations, type Automation } from './automations.ts'
import type { Happened } from './trigger.ts'
import { Browsers } from './browser.ts'
import { Chats } from './chats.ts'
import { ended, Engine } from './engine/engine.ts'
import { sh } from './engine/git.ts'
import { userName } from './user-name.ts'
import { Artifacts, browserChecker, type Checker } from './artifacts.ts'
import { Machines } from './machines.ts'
import { agentEnv, BOX } from './box.ts'
import { HOST, NAME, placeId, Places } from './places.ts'
import { privatePrompt, coordinatorPrompt } from './prompts.ts'
import type { Harness } from './restart.ts'
import { Revivals } from './revive.ts'
import { carryOn, cutCardId, Retries, type Retry, wakePlan } from './retry.ts'
import { Settings, type Level } from './settings.ts'
import { Vault } from './secrets.ts'
import { RequestedNewsMailbox } from './requested-news.ts'
import { Unread } from './unread.ts'
import { Monitor, meters, procLines, summary, topProcs, type HealthEvent, type Kind } from './health.ts'
import { has } from '../plugins.ts'
import { REPLY_AFTER_CARD, BY_AUTOMATION } from './source-helpers.ts'

export class LiveSourceState extends Emitter<SourceEvents> {
  readonly kind = 'live' as const
  user = userName()
  settings = new Settings()
  places = new Places()
  agents = new Agents()
  chats = new Chats(
    this.agents,
    (k) => this.chatName(k),
    () => this.user,
  )
  engine = new Engine(this.agents, this.chats, this.places, this.settings)
  automations = new Automations()
  artifacts = new Artifacts()
  /** agents' secrets: one file on the main machine, which a worker for another machine reads there */
  vault = new Vault(process.env.LINECLEAR_MAIN_HOME || HOME)
  /** opens an artifact at phone width before anyone sees it (a test puts its own here) */
  checker: Checker = browserChecker(
    // on this machine, whichever machine the artifact came from
    (args) => sh(['agent-browser', ...args], HOME, { timeoutMs: 45_000, here: true }),
    (html, data) => wrapPage(html, { check: true, phone: true, data }),
  )
  /** turns the model's provider cut off: waited out and tried again, then a task's backup agent or the human (retry.ts) */
  retries = new Retries({
    nudge: (key, text) => {
      // a task stopped, paused or finished meanwhile is left as it is
      if (key.includes('/') && !this.engine.mayRetry(key)) return this.retries.clear(key)
      this.agents.send(key, text, { ensure: key.includes('/') ? () => this.resumeTaskAgent(key) : () => this.coordinator(key) }).catch(() => undefined)
    },
    over: (key, r) => this.cannotGoOn(key, r),
    // its account may be back: a chat is never written 'carry on' while its model may still be out, so a task moves to
    // its backup agent first, unless the provider said when the account is back
    wake: (key, r) => {
      if (key.includes('/') && !this.engine.mayRetry(key)) return this.retries.clear(key)
      const id = key.split('/')[0]
      if (key.includes('/') && wakePlan(r, this.engine.canSwitch(id)) === 'switch') return void this.engine.cantGoOn(id, r.reason).catch(() => undefined)
      this.agents
        .send(key, carryOn(r.reason), { ensure: key.includes('/') ? () => this.resumeTaskAgent(key) : () => this.coordinator(key) })
        .catch(() => undefined)
    },
    changed: (key) => {
      if (key.includes('/')) this.engine.retried(key)
      this.emit('snapshot')
    },
  })
  /** this machine's load, memory, disks and herdr, sampled every 30 seconds; its coordinator hears when one is past
   *  its limit (Settings → the machine). Tests never measure the machine they run on: they tick it themselves */
  health = new Monitor(
    () => this.settings.machine(),
    () => this.agents.reachable,
    (e) => void this.onHealth(e).catch(() => undefined),
    undefined,
    { read: () => readJson('health.json', {}), write: (w) => writeJson('health.json', w) },
  )
  /** when each chat last had something new, and how far you have read each (on the main machine) */
  unread = new Unread()
  /** when this server started: only what comes after it buzzes as a new message */
  protected born = Date.now()
  protected requestedNews = new RequestedNewsMailbox(process.env.LINECLEAR_MAIN_HOME ?? HOME)
  protected drainingNews = false
  protected watched: string[] = []
  /** the task whose card went up last, for its news that follows at once */
  protected carded?: string
  protected terms: string[] = []
  protected timers: ReturnType<typeof setInterval>[] = []
  /** coordinators being started again in their own folder (reseat) */
  protected reseating = new Set<string>()
  /** agents that stopped or run on outdated files, started again by Lineclear (revive.ts) */
  revivals = new Revivals()
  protected reviving = new Set<string>()
  /** when a busy machine last had its finished tasks' browsers closed */
  protected sweptAt = 0
  devices: () => string[] = () => []
  /** the main machine runs every other machine saved in herdr, each from a worker of its own (machines.ts); a worker
   *  is one of those (box.ts) */
  peers: Machines | null = BOX ? null : new Machines(process.env.NODE_ENV === 'test' || process.env.LINECLEAR_SCRATCH ? null : undefined)
  /** the machines herdr has saved and enabled that were looked at are the engine's: placement sees them. Run as
   *  `peers` shows a change */
  syncMachines() {
    if (this.peers) this.engine.setMachines(this.peers.boxes())
  }

  /** each task's shared browser */
  browsers = has('browser')
    ? new Browsers({
        host: NAME,
        user: () => this.user,
        working: (task) => this.agents.status(`${task}/Agent`) === 'working',
        tell: (task, text) => void this.agents.send(`${task}/Agent`, hidden(text, 'browser')).catch(() => undefined),
        idleClose: (task) => {
          const t = this.engine.task(task)
          return this.settings.idleClose(t ? this.levelOf(t.project) : 'machine')
        },
      })
    : null

  /** the shared browsers whose task stopped, is done or gone: closed (and a done or gone one's profile removed). Says
   *  which tasks they were */
  async sweepBrowsers(): Promise<string[]> {
    if (!this.browsers) return []
    const task = (id: string) => this.engine.tasks.find((t) => t.id === id)
    return this.browsers.sweep(
      (id) => !!task(id) && !ended(task(id)!) && !task(id)!.stopped && !task(id)!.archived,
      (id) => !task(id) || ended(task(id)!),
    )
  }

  /* ---------- names ---------- */

  chatName(key: string) {
    if (key.includes('/')) {
      const [id, role] = key.split('/')
      return `${id} ${role.toLowerCase()}`
    }
    return this.placeList().find((p) => p.chat === key)?.name ?? key
  }

  protected placeList(): Place[] {
    return this.listed().places
  }

  /** a place by the name it shows, among this machine's own, or by its full id: a name never reaches another machine's space */
  protected placeNamed(name: string): Place | undefined {
    const own = this.places.find(name)
    return this.placeList().find((x) => x.id === (own?.id ?? name))
  }

  /** every space and every machine, as the sidebar shows them: this machine's, then the others' as they last showed
   *  themselves (just after a start, while they connect, as before it), the names the human gave them, in their order */
  protected listed(): { places: Place[]; machines: Machine[]; sections: Section[] } {
    const ts = this.engine.tasks
    const status = (ids: string[], coord: string[]): Place['status'] => {
      const mine = ts.filter((t) => ids.includes(t.project) && !t.archived).map((t) => this.engine.statusOf(t))
      if (mine.includes('need') || ids.some((id) => this.asks()[id])) return 'need'
      if (mine.includes('ready')) return 'ready'
      if (mine.includes('work') || mine.includes('merging') || coord.some((k) => this.agents.status(k) === 'working')) return 'work'
      return 'idle'
    }
    const peers = this.peers?.list() ?? []
    const up = this.agents.reachable
    const machines: Machine[] = [
      {
        id: placeId.machine(),
        machine: HOST,
        name: NAME,
        status: up ? 'idle' : 'off',
        unreachableSince: up ? undefined : clock(this.agents.lastReach),
        health: this.healthView(),
        herdrDown: up ? undefined : clock(this.agents.lastReach),
      },
    ]
    const places: Place[] = this.places.shown().map(({ id, name, space }) => ({
      id,
      name,
      machine: HOST,
      ...(space ? {} : { home: true }),
      // what its lists show: a home space its machine's, the main machine's every machine's
      level: space ? 2 : peers.length ? 0 : 1,
      status: space
        ? status([id], [id])
        : status(
            this.places.spaces.map((p) => placeId.space(p.name)),
            [id],
          ),
      chat: id,
      ...(space ? { githubRemote: !!space.github } : {}),
      // herdr gone: this machine's chats say so plainly
      ...(up ? {} : { herdrDown: clock(this.agents.lastReach) }),
    }))
    for (const l of peers) {
      const m = l.snap?.machines?.find((x) => x.machine === l.rec.machine) ?? {
        id: placeId.machine(l.rec.machine),
        machine: l.rec.machine,
        name: l.rec.machine,
        status: 'idle' as const,
      }
      const away = !l.reachable ? (l.connecting ? { connecting: true } : { status: 'off' as const, unreachableSince: clock(l.down ?? l.rec.lastSeen) }) : {}
      machines.push({ ...m, ...away })
      // a machine never reached yet still has its home space, to come back to
      const theirs = l.snap?.places ?? [
        {
          id: placeId.home(l.rec.machine),
          name: 'home',
          machine: l.rec.machine,
          home: true,
          level: 1 as const,
          status: 'off' as const,
          chat: placeId.home(l.rec.machine),
        },
      ]
      for (const p of theirs) places.push({ ...p, ...(p.home ? { level: 1 as const } : {}), ...away })
    }
    // the names the human gave them: a space's by the space rules (another on its machine with it keeps its own)
    for (const m of machines) {
      if (this.places.names[m.id]) m.name = this.places.names[m.id]
      if (this.places.emojis[m.id]) m.emoji = this.places.emojis[m.id]
      else delete m.emoji
    }
    for (const p of places) {
      const want = this.places.names[p.id] && slugify(this.places.names[p.id])
      if (want && !places.some((x) => x !== p && x.machine === p.machine && x.name === want)) p.name = want
    }
    return sortPlaces(places, machines, this.places.order, this.places.sections)
  }

  /** open coordinator questions by place: a choice card not answered yet, or the CLI's own menu (a permission) it waits on */
  asks(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const p of [placeId.home(), ...this.places.spaces.map((x) => placeId.space(x.name))]) {
      const open = this.chats
        .log(p)
        .posted.find((x) => x.question?.id.startsWith('ask:') && x.question.sent === undefined && this.chats.log(p).answers[x.question.id] === undefined)
      if (open) out[p] = open.question!.id
      else if (this.agents.status(p) === 'blocked') out[p] = 'blocked'
    }
    return out
  }

  /* ---------- coordinators ---------- */

  /**
   * Start (or resume) a place's coordinator: on Settings' CLI, model and effort the first time, then on what it runs on
   * (its chat's pickers change those) until it is restarted on others (`as`; `restart` stops its turn and says what
   * it is told first).
   */
  protected coordinator(id: string, o: { as?: Harness; restart?: () => Promise<string | void> } = {}) {
    const c = this.places.coordinator(id)
    if (!c) throw new Error(`No place ${id}`)
    const set = this.settings.harness('coordinator', this.spaceKey(id))
    const rec = this.agents.record(id)
    // a record made before its CLI listed models (pi's registry) has no model, and that CLI won't start without one
    const unset = !!rec && rec.kind === set.kind && !!chooseModel(rec.kind, rec.model)
    const h = o.as ?? (rec && !unset ? undefined : set)
    const spec: Spec = {
      key: id,
      name: c.name,
      kind: h?.kind ?? rec!.kind,
      // '' is the CLI's own default
      ...(h ? { model: h.model ?? '', effort: h.effort ?? '', set } : {}),
      cwd: c.cwd,
      workspace: c.workspace,
      was: (c as { was?: string }).was,
      tab: c.tab,
      system:
        coordinatorPrompt({ role: this.roleOf(id), name: c.label, path: c.path, machine: NAME, chat: id }) +
        '\n\n' +
        privatePrompt(this.settings.instructions('coordinator', this.spaceKey(id))),
      env: agentEnv(id, ROOT),
    }
    return o.restart ? this.agents.restart(spec, o.restart) : this.agents.ensure(spec)
  }

  /** the chat card is posted: tell the watchers, and raise an alert that opens it */
  protected stoppedAlert(key: string, id: string, body: string, tag: string) {
    if (this.watched.includes(key)) this.emit('chat', key)
    this.alert({ id: randomUUID(), from: 'Lineclear', title: `${this.chatName(key)} stopped`, body, go: { place: key, focus: id }, tag })
  }

  /** an agent can't go on by itself: a task's backup agent takes over, or it waits for you; a coordinator tells you in
   *  its chat, with an alert */
  protected cannotGoOn(key: string, r: Retry) {
    if (key.includes('/')) return void this.engine.cantGoOn(key.split('/')[0], r.reason).catch(() => undefined)
    // one card per chat and reason: a failure again updates it, never posts another
    const id = cutCardId(key, r.reason)
    this.chats.post(key, { id, card: { id, text: `Cut off by its provider: ${r.reason.charAt(0).toLowerCase()}${r.reason.slice(1)}. Write to carry on.` } })
    this.stoppedAlert(key, id, `${r.reason}. ${r.words}`.slice(0, 200), `cut:${key}`)
  }

  /* ---------- spaces ---------- */

  /** a space's folder key: its name as added, or a home space's ~ */
  protected spaceKey(id: string) {
    return id === placeId.home() ? '~' : this.places.space(id)?.name
  }

  /** the level a space's own defaults are set at */
  protected levelOf(id: string): Level {
    const key = this.spaceKey(id)
    return key ? { space: key } : 'machine'
  }

  /** what a space's coordinator does: its space's work; a home space's also its machine's; the main machine's home
   *  space's also every machine's overview */
  protected roleOf(id: string): 'space' | 'home' | 'main' {
    if (id !== placeId.home()) return 'space'
    return BOX ? 'home' : 'main'
  }

  /* ---------- machine health ---------- */

  /** how many tasks work here, against the limit: "3 of 5 working, 2 held" */
  protected workingLine() {
    const max = this.settings.machine().max
    const held = this.engine.heldTasks().length
    return `${this.engine.working()}${max === null ? '' : ` of ${max}`} working${held ? `, ${held} held` : ''}`
  }

  /** this machine's numbers for the screen */
  protected healthView() {
    const s = this.health.last
    if (!s || !has('health')) return undefined
    const held = this.engine.heldTasks()
    return {
      meters: meters(s, this.settings.machine(), this.health.told()),
      herdr: this.agents.reachable,
      working: this.engine.working(),
      max: this.settings.machine().max ?? undefined,
      held: held.length,
      heldWhy: held[0] && this.engine.subOf(held[0]),
      at: clock(s.at),
    }
  }

  /**
   * Something crossed its limit, or came back under: a card in the machine's home space's chat, and news for its
   * coordinator with the numbers and what uses it most. Only measured and told: what to do is the coordinator's call.
   */
  protected async onHealth(e: HealthEvent) {
    if (!has('health')) return
    const s = e.sample
    const l = this.settings.machine()
    const load = (x: number | null) => +((x ?? 0) * s.cores).toFixed(1)
    const disk = s.disks.reduce((a, d) => (d.pct > a.pct ? d : a), s.disks[0])
    const over: Record<Kind, string> = {
      cpu: `CPU load has stayed over ${load(l.alertLoad)} (${l.alertLoad}× its ${s.cores} cores) for 10 minutes: ${s.load.toFixed(1)} now`,
      memory: `memory is over ${l.alertMemory}%: ${Math.round((s.memUsed / s.memTotal) * 100)}% in use`,
      disk: `${disk?.path === homedir() ? 'home' : disk?.path} is ${disk?.pct}% full (over ${l.alertDisk}%), ${Math.round(disk?.freeGb ?? 0)} GB free`,
      herdr: `herdr isn't answering (since ${clock(e.since ?? Date.now())}), so its agents can't hear anything`,
    }
    const back: Record<Kind, string> = {
      cpu: `CPU load is back under ${load(l.alertLoad)}: ${s.load.toFixed(1)} now`,
      memory: `memory is back under ${l.alertMemory}%`,
      disk: 'disk space is back under its limit',
      herdr: `herdr answers again; it was gone from ${clock(e.since ?? Date.now())} to ${clock(Date.now())}`,
    }
    // on its card, a few words
    const brief: Record<Kind, [string, string]> = {
      cpu: [`CPU load is high: ${s.load.toFixed(1)}`, 'CPU load is back to normal'],
      memory: [`memory is ${Math.round((s.memUsed / s.memTotal) * 100)}% used`, 'memory is back to normal'],
      disk: [`${disk?.path === homedir() ? 'home' : disk?.path} is ${disk?.pct}% full`, 'disk space is back to normal'],
      herdr: ["herdr isn't answering", 'herdr answers again'],
    }
    const words = e.what === 'over' ? over[e.kind] : back[e.kind]
    const machine = placeId.home()
    // one line per kind, updated in place: a load hovering at its limit would otherwise post a pair each time
    const id = `health:${e.kind}`
    this.chats.post(machine, {
      id,
      card: { id, text: brief[e.kind][e.what === 'over' ? 0 : 1], health: { level: e.what === 'over' ? 'over' : 'ok', machine: NAME } },
    })
    if (this.watched.includes(machine)) this.emit('chat', machine)
    this.emit('snapshot')
    // for the main machine's home space, when this is another machine's worker (as news above), herdr gone too: it
    // still runs
    this.emit('news', { place: machine, line: words, kind: 'health', about: { kind: e.kind, what: e.what } })
    // herdr gone takes its agents with it, coordinators too: they hear of it once it is back
    if (e.kind === 'herdr' && e.what === 'over') return
    // browsers that finished tasks left open go first: a web game in one takes a core or two for nothing
    const swept = e.what === 'over' && (e.kind === 'cpu' || e.kind === 'memory') ? await this.sweepBrowsers().catch(() => []) : []
    const procs =
      e.kind === 'cpu' || e.kind === 'memory'
        ? procLines(
            await topProcs(e.kind),
            this.engine.tasks.filter((t) => !ended(t)),
            e.kind,
          )
        : []
    const what =
      e.what === 'back'
        ? e.kind === 'herdr'
          ? 'Agents it ran may have stopped with it: check which tasks need writing to again (lineclear task list).'
          : 'If you paused or held tasks for it, they may go on now.'
        : e.kind === 'disk'
          ? "Decide what to do: clean up (finished tasks' leftovers, caches, /tmp), pause tasks, or tell the human."
          : 'Decide what to do: pause tasks (lineclear task pause <id>; a message to one lets it go on), queue them after others (lineclear task queue <id> --after <ids>), or tell the human.'
    const closed = swept.length
      ? [`Lineclear closed ${swept.length} shared browser${swept.length > 1 ? 's' : ''} that finished tasks left open (${swept.join(', ')}).`]
      : []
    const text = [`Machine ${NAME}: ${words}.`, summary(s), `Tasks: ${this.workingLine()}.`, ...closed, ...procs, what].join('\n')
    if (e.what === 'over') this.fireTaskAutomations({ event: 'health' }, machine)
    const tail = `Act on it if the human asked you to handle such things. If it can’t wait, alert the human with lineclear alert and say why. A card in this chat already shows the human the news: ${REPLY_AFTER_CARD}`
    this.agents
      .send(machine, hidden(`${text}\n${tail}`, 'health', { kind: e.kind, what: e.what }), { ensure: () => this.coordinator(machine) })
      .catch(() => undefined)
  }

  alert(a: Alert) {
    if (has('alerts')) this.emit('alert', a)
  }

  /* ---------- automations ---------- */

  protected fireTaskAutomations(h: Happened, project: string, task?: string) {
    // a task an automation added sets off no automation on being added: one could add tasks without end
    if (h.event === 'added' && task && this.engine.task(task)?.by.startsWith(BY_AUTOMATION)) return
    for (const a of this.automations.on(h, project)) this.fire(a)
  }

  /** an automation runs (timed: on its time rule): a new task from its template, with a fresh agent of its own */
  protected fire(a: Automation, timed = false) {
    const p = this.places.space(a.place)
    try {
      if (!p) throw new Error('Its space is gone')
      const t = this.engine.add({ project: p.name, title: a.task.title, desc: a.task.desc, by: `${BY_AUTOMATION} “${a.name}”`, agent: a.task.agent })
      this.automations.fired(a, { task: t.id }, Date.now(), timed)
      return t
    } catch (e) {
      this.automations.fired(a, { error: (e as Error).message }, Date.now(), timed)
      this.emit('snapshot')
      return undefined
    }
  }

  protected resumeTaskAgent(key: string) {
    return this.engine.resume(key.split('/')[0])
  }
}
