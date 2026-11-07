import { LinkBackoff } from './recovery.ts'
import { Emitter } from '../source.ts'
import { readJson, writeJson } from '../store.ts'
import { ColdAgents } from './engine/cold.ts'
import { addLog } from './log-list.ts'
import type { AgentHerdr, TermScreen } from '../../shared/types.ts'
import type { Subscription, AgentInfo, AgentStatus } from './herdr.ts'
import { findPiLog } from './readers/find.ts'
import { PasteWatch } from './paste-watch.ts'
import { AgentTerminals } from './agent-terminals.ts'
import { machineNews } from './quiet.ts'
import { mirrored } from './mfs.ts'
import { SecretAccess } from './secret-access.ts'
import { AgentRoutes } from './agent-routes.ts'
import { type RpcAgent, rpcPane } from './agent-rpc.ts'
import type { AgentRecord, OutItem, Hold, Sent, Events } from './agents-helpers.ts'

/** internal news carries a cid of this form and is never a screen's message */
export const isNews = (cid?: string) => !!cid?.startsWith('requested-news:')
export const LATELY = 600_000
const lately = (list: OutItem[], now: number) => list.filter((o) => now - o.at < LATELY)

export class AgentsState extends Emitter<Events> {
  private cold = new ColdAgents<AgentRecord>()
  records: Record<string, AgentRecord> = this.cold.read()
  // news held in an older version's outbox is dropped too (quiet.ts)
  outbox: OutItem[] = readJson<OutItem[]>('outbox.json', []).filter((o) => !machineNews(o.text))
  live = new Map<string, AgentInfo>()
  /** the agents that run as a child of this server, by chat key: herdr knows nothing of them */
  rpcs = new Map<string, RpcAgent>()
  protected byName = new Map<string, string>()
  protected timer: ReturnType<typeof setInterval> | null = null
  protected sub!: Subscription
  readonly secretAccess = new SecretAccess()
  secretScope: (chat: string) => string[] | undefined = () => undefined
  protected refreshing = false
  protected readAgain = false
  /** the subscription dropped and has not opened again: a read meanwhile does not make herdr reachable */
  protected subDown = false
  protected retryTimer: ReturnType<typeof setTimeout> | null = null
  /** every agent herdr listed, named or not: events keep it current between reads */
  protected listed: AgentInfo[] = []
  protected pasteDue = new Set<string>()
  protected paste = new PasteWatch()
  protected heardAt = 0
  protected stopped = false
  protected retryAt = 0
  protected recovery = new LinkBackoff()
  protected routes = new AgentRoutes(this)
  protected starting = new Map<string, Promise<AgentInfo | null>>()
  stopping = new Set<string>()
  protected delivering = new Set<string>()
  /** what went in lately with a screen's id: the chat gives the id back once it reads it from the log */
  protected delivered: OutItem[] = []
  protected newsReceipts: string[] = readJson('requested-news-receipts.json', [])
  /** everything that went in lately: what a merge checks the agent has read, so kept across a restart */
  protected typed: OutItem[] = readJson('typed.json', [])
  protected failures: { key: string; cid: string; error: string; at: number }[] = []
  protected inflight = new Map<string, Promise<Sent>>()
  /** since when an agent with screen sends waiting for it is gone (fail after strandAfter) */
  protected stranded = new Map<string, number>()
  /** since when herdr lists an agent that just started but won't take input yet (fail after unreadyFor) */
  unready = new Map<string, number>()
  /** after a failed hand-over: when the next try may be, and how many failed in a row */
  backoff = new Map<string, { until: number; n: number }>()
  strandAfter = 30_000
  unreadyFor = 60_000
  backoffMs = 2000
  backoffMax = 60_000
  /** an agent herdr won't take a prompt for this long gets the text typed into its pane (pi is up in about 2 s but herdr
   *  names it later: a 10 s value made every first call 10 s late) */
  paneAfter = 2000
  /** a message without a screen's id (the brief) still not in after this long is given up on */
  briefFor = 300_000
  readyMs = 30_000
  submitMs = 5000
  startedIn = new Map<string, string>()
  reachable = true
  lastReach = Date.now()
  protected terminals = new AgentTerminals(
    (k) => this.info(k),
    (k, s) => this.emit('output', k, s),
    (k) => this.screen(k), // by name, so a subclass or a test can replace screen
  )
  protected told = new Map<string, AgentStatus | 'gone'>()
  /** whether a menu a slash command opened is up, which herdr doesn't see: typed text could pick an option */
  menuUp?: (key: string) => boolean
  beforeInput?: (key: string) => Promise<void>
  /** why nothing is sent to this key's pane when its task is done or closed (it has none), else nothing */
  taskEnded?: (key: string) => string | undefined

  save() {
    this.cold.write(this.records)
    writeJson('outbox.json', this.outbox)
  }

  /** drops what waits and matches; whether any did */
  protected dropWhere(match: (o: OutItem) => boolean) {
    const kept = this.outbox.filter((o) => !match(o))
    if (kept.length === this.outbox.length) return false
    this.outbox = kept
    this.save()
    return true
  }

  dropOutboxWhere(over: (key: string) => boolean) {
    this.dropWhere((o) => over(o.key))
  }

  protected unwanted(item: OutItem) {
    return !!item.launch && item.launch !== this.records[item.key]?.launch
  }

  protected unroute(key: string) {
    this.routes.drop(key)
  }

  /** what a screen sent waits only on a menu or a starting agent: one whose agent is gone (or herdr out of reach) for a
   *  while fails */
  checkStranded(now = Date.now()) {
    const keys = new Set(this.outbox.filter((o) => o.cid && !isNews(o.cid)).map((o) => o.key))
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

  /** an RPC agent as an entry of the agent list, so everything that reads `live` reads it the same */
  protected rpcInfo(r: AgentRecord, a: RpcAgent): AgentInfo {
    return {
      agent: r.kind,
      agent_status: a.status,
      agent_session: a.sessionFile ? { source: 'rpc', agent: r.kind, kind: 'path', value: a.sessionFile } : null,
      cwd: r.cwd,
      name: r.name,
      pane_id: rpcPane(r.key),
      tab_id: '',
      workspace_id: '',
      interactive_ready: true,
    }
  }

  /** herdr's word on the agent as the events and reads kept it: nothing is asked of herdr */
  herdrView(key: string): AgentHerdr | undefined {
    const a = this.info(key)
    const s = a?.agent_session
    return a && { status: a.agent_status, ...(s?.kind === 'path' ? { session: s.value } : {}), pasted: this.paste.has(key), at: this.heardAt }
  }

  status(key: string): AgentStatus | 'gone' {
    return this.info(key)?.agent_status ?? 'gone'
  }

  protected lookAtPastes() {
    for (const key of this.byName.values()) {
      if (this.stopped) return
      if (this.pasteDue.delete(key) && !this.rpcs.has(key)) void this.paste.look(key, this.records[key]?.started ?? 0, () => this.info(key)?.pane_id)
    }
  }

  /** what a screen sent that waits for this agent fails: the screen says why and offers Retry */
  protected fail(key: string, error: string) {
    const mine = this.outbox.filter((o) => o.key === key && o.cid && !isNews(o.cid))
    if (!this.dropWhere((o) => mine.includes(o))) return
    const now = Date.now()
    this.failures = [...this.failures.filter((f) => now - f.at < LATELY), ...mine.map((o) => ({ key, cid: o.cid!, error, at: now }))]
    this.emit('failed', key)
  }

  protected keepLog(key: string, file: string | undefined) {
    const r = this.records[key]
    if (!r || !file || !addLog(r, file)) return
    this.save()
    this.emit('logs', key)
  }

  protected learnSession(key: string, a?: AgentInfo) {
    const s = a?.agent_session
    if (s?.kind === 'path') this.keepLog(key, mirrored(s.value))
  }

  /** find a log file this CLI started since the agent (re)started, when herdr didn't name one */
  discoverLog(key: string) {
    const r = this.records[key]
    if (r) this.keepLog(key, r.kind === 'pi' ? findPiLog(r.cwd, r.started - 5000) : undefined)
  }

  /** why this agent takes nothing now, except an agent herdr refused as not ready yet: that one is simply tried again */
  protected heldBy(key: string, item?: Pick<OutItem, 'idle'>): Hold | undefined {
    const st = this.status(key)
    // stopping for a restart: what you send goes to the agent it starts on
    if (st === 'gone' || this.records[key]?.finished || this.stopping.has(key) || this.info(key)?.interactive_ready === false) return 'start'
    if (st === 'blocked' || this.menuUp?.(key)) return 'menu'
    if (item?.idle && st === 'working') return 'turn'
    return undefined
  }

  protected giveUpOnBriefs(key: string) {
    const now = Date.now()
    if (this.dropWhere((o) => o.key === key && !!o.brief && now - o.at >= this.briefFor)) this.emit('undelivered', key)
  }

  protected went(item: OutItem) {
    const now = Date.now()
    const entry = { ...item, at: now }
    this.typed = [...lately(this.typed, now), entry].slice(-200)
    writeJson('typed.json', this.typed)
    if (!item.cid) return
    if (isNews(item.cid) && !this.newsReceipts.includes(item.cid)) {
      this.newsReceipts.push(item.cid)
      writeJson('requested-news-receipts.json', this.newsReceipts)
    }
    this.delivered = [...lately(this.delivered, now), entry].slice(-200)
  }
  screen(key: string): Promise<TermScreen> {
    return this.terminals.screen(key)
  }
}
