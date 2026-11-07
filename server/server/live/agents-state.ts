import { LinkBackoff } from './recovery.ts'
import { join } from 'node:path'
import { Emitter } from '../source.ts'
import { readJson, writeJson } from '../store.ts'
import { ColdAgents } from './engine/cold.ts'
import { addLog } from './log-list.ts'
import type { AgentHerdr, TermScreen } from '../../shared/types.ts'
import { herdr, type Subscription, type AgentInfo, type AgentStatus } from './herdr.ts'
import { findCodexLog, findPiLog } from './readers/find.ts'
import { PasteWatch } from './paste-watch.ts'
import { TerminalClock } from './terminal-clock.ts'
import { machineNews } from './quiet.ts'
import { mirrored } from './mfs.ts'
import { agentEnv, BOX, helperDir, run } from './box.ts'
import { ROOT } from '../root.ts'
import { inputHoldsText } from './paste-watch.ts'
import { SecretAccess } from './secret-access.ts'
import { isAgentProcess } from './agent-process.ts'
import { type AgentRecord, type OutItem, type Hold, type Sent, ROUTING_FAILURE, type Events, holdFrom } from './agents-helpers.ts'

export class AgentsState extends Emitter<Events> {
  private cold = new ColdAgents<AgentRecord>()
  records: Record<string, AgentRecord> = this.cold.read()
  // news held in an older version's outbox is dropped too (quiet.ts)
  outbox: OutItem[] = readJson<OutItem[]>('outbox.json', []).filter((o) => !machineNews(o.text))
  live = new Map<string, AgentInfo>()
  protected byName = new Map<string, string>()
  protected timer: ReturnType<typeof setInterval> | null = null
  protected sub!: Subscription
  readonly secretAccess = new SecretAccess()
  secretScope: (chat: string) => string[] | undefined = () => undefined
  protected refreshing = false
  protected readAgain = false
  /** the subscription dropped and has not opened again: a read that answers meanwhile does not make herdr reachable */
  protected subDown = false
  protected retryTimer: ReturnType<typeof setTimeout> | null = null
  /** every agent herdr listed, named or not: events keep it current between reads of the session */
  protected listed: AgentInfo[] = []
  /** agents whose status changed since their screen was read: the screen is read only for these */
  protected screenDue = new Set<string>()
  /** agents whose status changed since their pane was looked at for the pasted brief */
  protected pasteDue = new Set<string>()
  protected paste = new PasteWatch()
  /** when the last event or session read changed the list of agents */
  protected heardAt = 0
  /** where each agent's CLI was last bound to a route, and whether it took */
  protected routeTried = new Map<string, { pane: string; at: number; ok: boolean }>()
  protected stopped = false
  protected retryAt = 0
  protected recovery = new LinkBackoff()
  protected routing = false
  protected routes = new Map<string, string>()
  protected starting = new Map<string, Promise<AgentInfo | null>>()
  /** agents being stopped for a restart: what you send waits for the one it starts */
  protected stopping = new Set<string>()
  protected delivering = new Set<string>()
  /** what went in lately with a screen's id: the chat gives the id back once it reads the message from the log */
  protected delivered: OutItem[] = []
  /** Durable internal news receipts, unlike the screen's short-lived send history. */
  protected newsReceipts: string[] = readJson('requested-news-receipts.json', [])
  /** everything that went in lately, with when: what a merge checks the agent has read, so kept across a restart */
  protected typed: OutItem[] = readJson('typed.json', [])
  /** what a screen sent that waited and then couldn't go in: the screen says so and offers Retry */
  protected failures: { key: string; cid: string; error: string; at: number }[] = []
  /** what a screen sent that is on its way now, by its id: sent again meanwhile, it goes in once */
  protected inflight = new Map<string, Promise<Sent>>()
  /** since when an agent with screen sends waiting for it is gone, or herdr out of reach */
  protected stranded = new Map<string, number>()
  /** how long that may last (an agent starting again) before what waits for it fails */
  strandAfter = 30_000
  /** since when herdr lists an agent that just started but won't take input yet (not yet its named agent): what waits
   *  for it is tried again on each refresh, and fails after unreadyFor */
  protected unready = new Map<string, number>()
  unreadyFor = 60_000
  /** after a failed hand-over: when the next try may be, and how many failed in a row (backoff, so herdr is never hammered) */
  backoff = new Map<string, { until: number; n: number }>()
  backoffMs = 2000
  backoffMax = 60_000
  /** an agent herdr won't take a prompt for this long gets the text typed into its pane instead. This was the fixed wait in every start:
   *  10 s of refused prompts before the brief was typed in, so a start took 23 s. The pane holds its CLI by then, and a shell prompt is never typed into. */
  paneAfter = 2_000
  /** a message without a screen's id (the brief) still not in after this long is given up on */
  briefFor = 300_000
  /** the pane each agent was last started in, to find it again when herdr lists it without its name */
  protected startedIn = new Map<string, string>()
  reachable = true
  lastReach = Date.now()
  /** each read of another machine's pane is an SSH connection of its own, so it is read less often */
  protected terminalClock = new TerminalClock(
    (k) => this.screen(k),
    (k, s) => this.emit('output', k, s),
    BOX ? 1500 : 500,
  )
  /** each watched pane's size in cells, and when it was read */
  protected sizes = new Map<string, { at: number; size: { cols: number; rows: number } | null }>()
  /** the status last told, by chat key */
  protected told = new Map<string, AgentStatus | 'gone'>()
  protected soon: ReturnType<typeof setTimeout> | null = null
  /** whether a menu a slash command opened is up, which herdr doesn't see: typed text could pick an option */
  menuUp?: (key: string) => boolean
  /** Read startup menus herdr may classify as idle before any text can choose from them. */
  beforeInput?: (key: string) => Promise<void>

  protected deliveryPaused = new Set<string>()
  acceptInput?: (item: OutItem) => boolean
  /** why nothing is sent to this key's pane when its task is done or closed (it has none), else nothing */
  taskEnded?: (key: string) => string | undefined

  save() {
    this.cold.write(this.records)
    writeJson('outbox.json', this.outbox)
  }

  /** what a screen sent waits only on a menu or a starting agent: one whose agent is gone (or herdr out of reach) for a
   *  while fails */
  checkStranded(now = Date.now()) {
    const keys = new Set(this.outbox.filter((o) => o.cid && !o.cid.startsWith('requested-news:')).map((o) => o.key))
    for (const key of this.stranded.keys()) if (!keys.has(key)) this.stranded.delete(key)
    for (const key of keys) {
      if (this.reachable && this.status(key) !== 'gone') {
        this.stranded.delete(key)
        continue
      }
      const since = this.stranded.get(key) ?? now
      this.stranded.set(key, since)
      if (now - since < this.strandAfter) continue
      this.stranded.delete(key)
      this.fail(key, this.reachable ? 'The agent stopped before it went in.' : 'Lost herdr before it went in.')
    }
  }

  info(key: string) {
    const r = this.records[key]
    return r ? this.live.get(r.name) : undefined
  }

  /** herdr's word on the agent as the events and reads kept it, for the snapshot: nothing is asked of herdr */
  herdrView(key: string): AgentHerdr | undefined {
    const a = this.info(key)
    const s = a?.agent_session
    return a && { status: a.agent_status, ...(s?.kind === 'path' ? { session: s.value } : {}), pasted: this.paste.has(key), at: this.heardAt }
  }

  status(key: string): AgentStatus | 'gone' {
    return this.info(key)?.agent_status ?? 'gone'
  }

  /** Bind the actual CLI process, not HERDR_PANE_ID (old shells can inherit another pane's id). */
  protected async bindRoute(r: AgentRecord, pane: string) {
    const p = await herdr.processInfo(pane)
    const proc = p.foreground_processes?.find((x) => x.pid && isAgentProcess(r.kind, x.argv))
    if (!proc?.pid || r.finished || this.records[r.key]?.finished || this.stopping.has(r.key)) {
      this.routes.delete(r.key)
      this.secretAccess.revoke(r.key)
      return
    }
    const env = agentEnv(r.key, ROOT)
    const chain = this.secretScope(r.key)
    const capability = chain ? this.secretAccess.issue(r.key, `${proc.pid}:${r.started}`, chain) : undefined
    const route = {
      chat: r.key,
      cwd: r.cwd,
      capability,
      credentialFile: this.records[r.key]?.env?.LINECLEAR_SECRET_FILE ?? r.env?.LINECLEAR_SECRET_FILE ?? env.LINECLEAR_SECRET_FILE,
      ...(BOX ? { helper: env.LINECLEAR_COMMAND } : { url: env.LINECLEAR_URL }),
    }
    const signature = JSON.stringify([proc.pid, route])
    if (this.routes.get(r.key) === signature) {
      this.emit('routed', r.key)
      return
    }
    const router = BOX ? join(helperDir(BOX.home), 'route.pl') : join(ROOT, 'helper', 'route.pl')
    const result = await run(['perl', router, '--bind', String(proc.pid)], { stdin: JSON.stringify(route), timeoutMs: 5000 })
    if (result.code) {
      this.routes.delete(r.key)
      this.secretAccess.revoke(r.key)
      throw new Error(ROUTING_FAILURE)
    }
    // A stop may have raced the asynchronous provisioning write. Never restore its authority.
    if (this.records[r.key]?.finished || this.stopping.has(r.key)) {
      this.secretAccess.revoke(r.key)
      return
    }
    this.routes.set(r.key, signature)
    this.emit('routed', r.key)
  }

  /** a route is bound when an agent is first seen in its pane (a restored session), and again after a failure, at
   *  most every 30 s: never on a timer for one that is bound */
  protected async repairRoutes() {
    if (this.routing) return
    this.routing = true
    try {
      for (const r of Object.values(this.records)) {
        const a = this.live.get(r.name)
        if (!a) {
          this.routeTried.delete(r.key)
          continue
        }
        const was = this.routeTried.get(r.key)
        if (was && was.pane === a.pane_id && (was.ok || Date.now() - was.at < 30_000)) continue
        const tried = { pane: a.pane_id, at: Date.now(), ok: true }
        this.routeTried.set(r.key, tried)
        await this.bindRoute(r, a.pane_id)
          .then(() => {
            // no CLI in the pane yet binds nothing
            tried.ok = this.routes.has(r.key)
          })
          .catch((e) => {
            tried.ok = false
            console.error(`lineclear: routing ${r.key}: ${e.message}`)
          })
      }
    } finally {
      this.routing = false
    }
  }

  /** a paste herdr may have swallowed is looked at when the agent is read again */
  protected lookAtPastes() {
    for (const key of this.byName.values()) {
      if (this.stopped) return
      if (this.pasteDue.delete(key)) void this.paste.look(key, this.records[key]?.started ?? 0, () => this.info(key)?.pane_id)
    }
  }

  /** what a screen sent that waits for this agent fails: the screen says why and offers Retry */
  protected fail(key: string, error: string) {
    const mine = this.outbox.filter((o) => o.key === key && o.cid && !o.cid.startsWith('requested-news:'))
    if (!mine.length) return
    const now = Date.now()
    this.outbox = this.outbox.filter((o) => !mine.includes(o))
    this.save()
    this.failures = [...this.failures.filter((f) => now - f.at < 600_000), ...mine.map((o) => ({ key, cid: o.cid!, error, at: now }))]
    this.emit('failed', key)
  }

  protected learnSession(key: string, a?: AgentInfo) {
    const r = this.records[key]
    const s = a?.agent_session
    if (!r || !s) return
    if (s.kind === 'path' && addLog(r, mirrored(s.value))) {
      this.save()
      this.emit('logs', key)
    }
  }

  /** find a log file this CLI started since the agent (re)started, when herdr didn't name one */
  discoverLog(key: string) {
    const r = this.records[key]
    if (!r) return
    const since = r.started - 5000
    const f = r.kind === 'codex' ? findCodexLog(r.cwd, since) : r.kind === 'pi' ? findPiLog(r.cwd, since) : undefined
    if (f && addLog(r, f)) {
      this.save()
      this.emit('logs', key)
    }
  }

  /** the same, without an agent herdr refused as not ready yet: that one is simply tried again */
  protected heldBy(key: string, item?: Pick<OutItem, 'idle'>): Hold | undefined {
    const st = this.status(key)
    // stopping for a restart: what you send goes to the agent it starts on
    if (st === 'gone' || this.records[key]?.finished || this.deliveryPaused.has(key) || this.stopping.has(key) || this.info(key)?.interactive_ready === false)
      return 'start'
    if (st === 'blocked' || this.menuUp?.(key)) return 'menu'
    if (item?.idle && st === 'working') return 'turn'
    return undefined
  }

  /** one thing into the CLI */
  protected async put(key: string, item: OutItem) {
    if (this.info(key)?.interactive_ready === false) await this.untilReady(key)
    await herdr.prompt(this.records[key].name, item.text)
    this.submitted(key)
  }

  /** a CLI just started takes no input yet: wait (at most readyMs) until herdr says it is ready, so the text is not
   *  pasted into a screen that is not listening */
  protected async untilReady(key: string) {
    if (Date.now() - (this.records[key]?.started ?? 0) > 120_000) return
    for (let t = 0; this.info(key)?.interactive_ready === false && t < this.readyMs; t += 100) await new Promise((r) => setTimeout(r, 100))
  }

  /** herdr's named agent never came up: after paneAfter the text is typed into the task's pane, so a brief always arrives */
  protected async typeIntoPane(key: string, item: OutItem, e: unknown) {
    if (holdFrom(e) !== 'start' || item.idle) return false
    const since = this.unready.get(key) ?? Date.now()
    this.unready.set(key, since)
    const pane = this.info(key)?.pane_id ?? this.startedIn.get(key)
    if (!pane || Date.now() - since < this.paneAfter) return false
    // a shell at its prompt would run the text as a command
    if (await herdr.paneIdle(pane).catch(() => true)) return false
    await herdr.paneText(pane, item.text)
    await herdr.paneKeys(pane, ['enter'])
    return true
  }

  /** a first message that herdr refused and has waited briefFor is dropped, and its owner told */
  protected giveUpOnBriefs(key: string) {
    const now = Date.now()
    const old = this.outbox.filter((o) => o.key === key && o.brief && now - o.at >= this.briefFor)
    if (!old.length) return
    this.outbox = this.outbox.filter((o) => !old.includes(o))
    this.save()
    this.emit('undelivered', key)
  }

  /** what waited for a task that is over is dropped */
  dropOutboxWhere(over: (key: string) => boolean) {
    const kept = this.outbox.filter((o) => !over(o.key))
    if (kept.length === this.outbox.length) return
    this.outbox = kept
    this.save()
  }

  /** how long a CLI just started has to become ready for input */
  readyMs = 30_000

  /** a CLI still starting can take a pasted message without its Enter: while the agent is just started, the turn is
   *  waited for (status working), and if it is still idle after, Enter goes again, until the agent works or its input
   *  is empty (an Enter in an empty input does nothing, so an unreadable screen gets it too). Never the text again:
   *  it sits in the input. */
  protected async submitted(key: string) {
    if (Date.now() - (this.records[key]?.started ?? 0) > 120_000) return
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const took = async () => {
      const step = Math.min(100, this.submitMs)
      for (let t = 0; t < this.submitMs; t += step) {
        const st = this.status(key)
        if (st === 'working' || st === 'blocked' || st === 'gone') return true
        await sleep(step)
      }
      return false
    }
    for (let tries = 0; tries < 5; tries++) {
      if (await took()) return
      const pane = this.info(key)?.pane_id
      if (!pane || this.status(key) !== 'idle') return
      const screen = await herdr.visible(pane).catch(() => undefined)
      if (screen !== undefined && !inputHoldsText(screen)) return
      await herdr.paneKeys(pane, ['enter']).catch(() => undefined)
    }
  }

  /** how long a CLI has to take what was put in before it is looked at */
  submitMs = 5000

  protected went(item: OutItem) {
    const now = Date.now()
    this.typed = [...this.typed.filter((o) => now - o.at < 600_000), { ...item, at: now }].slice(-200)
    writeJson('typed.json', this.typed)
    if (!item.cid) return
    if (item.cid.startsWith('requested-news:') && !this.newsReceipts.includes(item.cid)) {
      this.newsReceipts.push(item.cid)
      writeJson('requested-news-receipts.json', this.newsReceipts)
    }
    this.delivered = [...this.delivered.filter((o) => now - o.at < 600_000), { ...item, at: now }].slice(-200)
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
}
