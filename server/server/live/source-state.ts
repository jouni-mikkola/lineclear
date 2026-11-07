import { chooseModel } from '../../../src/models.ts'
import { randomUUID } from 'node:crypto'
import { clock } from '../../shared/time.ts'
import type { Alert, Place } from '../../shared/types.ts'
import { Emitter, type SourceEvents } from '../source.ts'
import { HOME, readJson, writeJson } from '../store.ts'
import { ROOT } from '../root.ts'
import { Agents, hidden, type Spec } from './agents.ts'
import { Chats } from './chats.ts'
import { ended, Engine } from './engine/engine.ts'
import { userName } from './user-name.ts'
import { Machines } from './machines.ts'
import { agentEnv, BOX } from './box.ts'
import { NAME, placeId, Places } from './places.ts'
import { privatePrompt, coordinatorPrompt } from './prompts.ts'
import type { Harness } from './restart.ts'
import { Revivals } from './revive.ts'
import { Settings, type Level } from './settings.ts'
import { Vault } from './secrets.ts'
import { RequestedNewsMailbox } from './requested-news.ts'
import { healthWords, Monitor, meters, procLines, summary, topProcs, type HealthEvent } from './health.ts'
import { REPLY_AFTER_CARD } from './source-helpers.ts'
import { listing } from './source-listing.ts'

export class LiveSourceState extends Emitter<SourceEvents> {
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
  /** agents' secrets: one file on the main machine, which a worker for another machine reads there */
  vault = new Vault(process.env.LINECLEAR_MAIN_HOME || HOME)
  /** this machine's load, memory, disks and herdr, sampled every 30 seconds; its coordinator hears when one is past
   *  its limit (Settings → the machine). Tests never measure the machine they run on: they tick it themselves */
  health = new Monitor(
    () => this.settings.machine(),
    () => this.agents.reachable,
    (e) => void this.onHealth(e).catch(() => undefined),
    undefined,
    { read: () => readJson('health.json', {}), write: (w) => writeJson('health.json', w) },
  )
  /** what the last look at each other machine found (source-views.ts readBoxes) */
  protected boxes = new Map<string, { read?: { busy?: 'cpu' | 'memory'; herdr: boolean }; at: number; reading: boolean }>()
  /** when each coordinator chat's newest message was seen, so a message buzzes once */
  protected newestSeen = new Map<string, number>()
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
  devices: () => string[] = () => []
  /** the main machine runs every other machine saved in herdr, each from a worker of its own (machines.ts); a worker
   *  is one of those (box.ts) */
  peers: Machines | null = BOX ? null : new Machines(process.env.NODE_ENV === 'test' || process.env.LINECLEAR_SCRATCH ? null : undefined)
  /** the machines herdr has saved and enabled that were looked at are the engine's: placement sees them. Run as
   *  `peers` shows a change */
  syncMachines() {
    if (this.peers) this.engine.setMachines(this.peers.boxes())
  }

  /** every task other machines last showed, each with the machine it is on */
  protected tasksOnPeers() {
    return (this.peers?.list() ?? []).flatMap((l) => (l.snap?.tasks ?? []).map((t) => ({ ...t, machine: l.rec.machine })))
  }

  /** one of those by its id */
  protected taskOnPeers(id: string) {
    return this.tasksOnPeers().find((t) => t.id.toUpperCase() === id.toUpperCase())
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

  protected listed() {
    return listing({ places: this.places, engine: this.engine, agents: this.agents, peers: this.peers, asks: this.asks(), health: this.healthView() })
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
    return `${this.engine.workingOn()}${max === null ? '' : ` of ${max}`} working${held ? `, ${held} held` : ''}`
  }

  /** this machine's numbers for the screen */
  protected healthView() {
    const s = this.health.last
    if (!s) return undefined
    const held = this.engine.heldTasks()
    return {
      meters: meters(s, this.settings.machine(), this.health.told()),
      herdr: this.agents.reachable,
      working: this.engine.workingOn(),
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
    const s = e.sample
    const { words, card } = healthWords(e, this.settings.machine())
    const machine = placeId.home()
    // one line per kind, updated in place: a load hovering at its limit would otherwise post a pair each time
    const id = `health:${e.kind}`
    this.chats.post(machine, {
      id,
      card: { id, text: card, health: { level: e.what === 'over' ? 'over' : 'ok', machine: NAME } },
    })
    if (this.watched.includes(machine)) this.emit('chat', machine)
    this.emit('snapshot')
    // for the main machine's home space, when this is another machine's worker (as news above), herdr gone too: it
    // still runs
    this.emit('news', { place: machine, line: words, kind: 'health', about: { kind: e.kind, what: e.what } })
    // herdr gone takes its agents with it, coordinators too: they hear of it once it is back
    if (e.kind === 'herdr' && e.what === 'over') return
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
    const text = [`Machine ${NAME}: ${words}.`, summary(s), `Tasks: ${this.workingLine()}.`, ...procs, what].join('\n')
    const tail = `Act on it if the human asked you to handle such things. If it can’t wait, alert the human with lineclear alert and say why. A card in this chat already shows the human the news: ${REPLY_AFTER_CARD}`
    this.agents
      .send(machine, hidden(`${text}\n${tail}`, 'health', { kind: e.kind, what: e.what }), { ensure: () => this.coordinator(machine) })
      .catch(() => undefined)
  }

  alert(a: Alert) {
    this.emit('alert', a)
  }

  protected resumeTaskAgent(key: string) {
    return this.engine.resume(key.split('/')[0])
  }
}
