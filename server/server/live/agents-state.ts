import { Emitter } from '../source.ts'
import { readJson, writeJson } from '../store.ts'
import { AgentRows } from './engine/cold.ts'
import { addLog, uniqueLogs } from './log-list.ts'
import type { AgentInfo, AgentStatus } from './herdr.ts'
import { findPiLog } from './readers/find.ts'
import { machineNews } from './quiet.ts'
import { mirrored } from './mfs.ts'
import { SecretAccess } from './secret-access.ts'
import { AgentRoutes } from './agent-routes.ts'
import { type RpcAgent, rpcPane } from './agent-rpc.ts'
import { SendFailures, SentLog, isNews } from './agents-sent.ts'
import type { AgentRecord, OutItem, Hold, Events } from './agents-helpers.ts'

export class AgentsState extends Emitter<Events> {
  private rows = new AgentRows<AgentRecord>()
  records: Record<string, AgentRecord> = this.rows.read()
  // news held in an older version's outbox is dropped too (quiet.ts)
  outbox: OutItem[] = readJson<OutItem[]>('outbox.json', []).filter((o) => !machineNews(o.text))
  private outboxWritten = JSON.stringify(this.outbox)
  live = new Map<string, AgentInfo>()
  /** the agents that run as a child of this server, by chat key: herdr knows nothing of them */
  rpcs = new Map<string, RpcAgent>()
  private byName = new Map<string, string>()
  readonly secretAccess = new SecretAccess()
  secretScope: (chat: string) => string[] | undefined = () => undefined
  private routes = new AgentRoutes(this)
  readonly sent = new SentLog()
  readonly failures = new SendFailures()
  stopping = new Set<string>()
  /** since when an agent with screen sends waiting for it is gone (fail after strandAfter) */
  private stranded = new Map<string, number>()
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
  /** whether a menu a slash command opened is up, which herdr doesn't see: typed text could pick an option */
  menuUp?: (key: string) => boolean
  beforeInput?: (key: string) => Promise<void>
  /** why nothing is sent to this key's pane when its task is done or closed (it has none), else nothing */
  taskEnded?: (key: string) => string | undefined

  constructor() {
    super()
    // records written before logs were kept once each
    for (const r of Object.values(this.records)) {
      r.logs = uniqueLogs(r.logs ?? [])
      this.byName.set(r.name, r.key)
    }
  }

  save() {
    this.rows.write(this.records)
    // a save for a record change leaves the outbox file as it is
    const waiting = JSON.stringify(this.outbox)
    if (waiting === this.outboxWritten) return
    this.outboxWritten = waiting
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

  hasRoute(key: string) {
    return this.routes.has(key)
  }

  bindRoute(r: AgentRecord, pane: string) {
    return this.routes.bind(r, pane)
  }

  bindRoutePid(r: AgentRecord, pid: number | undefined) {
    return this.routes.bindPid(r, pid)
  }

  repairRoutes() {
    return this.routes.repair()
  }

  trackName(r: AgentRecord) {
    this.byName.set(r.name, r.key)
  }

  protected untrack(r: AgentRecord) {
    if (this.byName.get(r.name) === r.key) this.byName.delete(r.name)
  }

  protected trackedKeys() {
    return [...this.byName.values()]
  }

  protected trackedNames() {
    return [...this.byName]
  }

  protected unstrand(key: string) {
    this.stranded.delete(key)
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

  status(key: string): AgentStatus | 'gone' {
    return this.info(key)?.agent_status ?? 'gone'
  }

  /** its last turn was stopped (pi's agent_settled said aborted), not finished */
  aborted(key: string): boolean {
    return this.rpcs.get(key)?.aborted ?? false
  }

  /** what a screen sent that waits for this agent fails: the screen says why and offers Retry */
  protected fail(key: string, error: string) {
    const mine = this.outbox.filter((o) => o.key === key && o.cid && !isNews(o.cid))
    if (!this.dropWhere((o) => mine.includes(o))) return
    this.failures.add(
      key,
      mine.map((o) => o.cid!),
      error,
    )
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
    this.sent.record(item)
  }
}
