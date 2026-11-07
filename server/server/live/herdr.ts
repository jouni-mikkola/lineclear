import { LinkBackoff } from './recovery.ts'
// herdr's socket API: newline-delimited JSON over a Unix socket. One request per connection (herdr closes it after
// the reply); a subscription keeps its connection open and streams events.
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { box } from './box.ts'

/** the herdr Lineclear is tested with, by test/herdr-contract.test.ts: an update of herdr raises it with that test green */
export const HERDR_TESTED = { version: '0.9.5', protocol: 22 }

/** the variable that points a child at one herdr socket */
const HERDR_SOCKET_ENV = 'HERDR_SOCKET_PATH'

/** the herdr socket of the machine the code works for: a machine with a session of its own names its socket */
function socketPath() {
  return box()?.socket ?? process.env[HERDR_SOCKET_ENV] ?? process.env.HERDR_SOCKET ?? join(homedir(), '.config', 'herdr', 'herdr.sock')
}

export class HerdrError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HerdrError'
  }
}

let n = 0

/** a connection to herdr's API socket */
interface Conn {
  write(s: string): void
  destroy(): void
  on(e: 'connect', f: () => void): void
  on(e: 'data', f: (d: Buffer) => void): void
  on(e: 'error' | 'close', f: (e?: Error) => void): void
}

function open(path: string): Conn {
  return connect(path)
}

/** herdr's socket refused the connection or is not there: herdr is down or restarting */
const gone = (e: Error & { code?: string }) => ['ECONNREFUSED', 'ENOENT', 'ECONNRESET', 'EPIPE'].includes(e.code ?? '') || /ECONNREFUSED|ENOENT/.test(e.message)

export function rpc<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000, path = socketPath()): Promise<T> {
  return send<T>(method, params, timeoutMs, path)
}

/** feeds each whole line of the socket's stream to onLine, which gives false to stop reading the chunk */
function lineReader(onLine: (line: string) => unknown) {
  let buf = ''
  return (d: Buffer) => {
    buf += d.toString('utf8')
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line && onLine(line) === false) return
    }
  }
}

/** the calls that only read: asking one again changes nothing. Any other call may have been done before its socket closed */
const READS = new Set([
  'ping',
  'session.snapshot',
  'agent.list',
  'agent.get',
  'workspace.list',
  'tab.list',
  'pane.list',
  'pane.read',
  'pane.layout',
  'pane.process_info',
])

/** a closed socket means the request came late, not that herdr is down: a read is asked once more and fails plainly on a
 *  second close; a send (`pane.send_*`, `agent.prompt`, a start) is never repeated, since it may have gone in */
async function send<T>(method: string, params: Record<string, unknown>, timeoutMs: number, path: string): Promise<T> {
  try {
    return await sendOnce<T>(method, params, timeoutMs, path)
  } catch (e) {
    if (!(e instanceof HerdrError) || e.code !== 'closed' || !READS.has(method)) throw e
    return sendOnce<T>(method, params, timeoutMs, path)
  }
}

function sendOnce<T>(method: string, params: Record<string, unknown>, timeoutMs: number, path: string): Promise<T> {
  const id = `shep-${Date.now().toString(36)}-${++n}`
  return new Promise<T>((resolve, reject) => {
    let done = false
    const sock = open(path)
    const finish = (f: () => void) => {
      if (done) return
      done = true
      clearTimeout(timer)
      sock.destroy()
      f()
    }
    const timer = setTimeout(() => finish(() => reject(new HerdrError('timeout', `herdr ${method} timed out`))), timeoutMs)
    sock.on('connect', () => sock.write(`${JSON.stringify({ id, method, params })}\n`))
    sock.on(
      'data',
      lineReader((line) => {
        const f = JSON.parse(line) as { id?: string; result?: T; error?: { code: string; message: string } }
        if (f.id !== id) return
        if (f.error) finish(() => reject(new HerdrError(f.error!.code, f.error!.message)))
        else finish(() => resolve(f.result as T))
      }),
    )
    // its socket refusing, or gone: herdr stopped or is starting again. Said plainly, never "connect ECONNREFUSED …"
    const closedError = () => new HerdrError('closed', `herdr closed the connection during ${method}`)
    sock.on('error', (e?: Error & { code?: string }) =>
      finish(() =>
        reject(
          e?.code === 'ECONNRESET' || e?.code === 'EPIPE' ? closedError() : new HerdrError('unreachable', !e || gone(e) ? "herdr isn't answering" : e.message),
        ),
      ),
    )
    sock.on('close', () => finish(() => reject(closedError())))
  })
}

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown'

interface AgentSession {
  source: string
  agent: string
  kind: 'id' | 'path'
  value: string
}

export interface AgentInfo {
  agent: string | null
  agent_status: AgentStatus
  agent_session?: AgentSession | null
  cwd: string | null
  foreground_cwd?: string | null
  name?: string | null
  pane_id: string
  tab_id: string
  workspace_id: string
  title?: string | null
  terminal_title_stripped?: string | null
  interactive_ready?: boolean
}

/** what runs in a pane (pane.process_info) */
export interface ProcessInfo {
  shell_pid?: number
  foreground_process_group_id?: number
  foreground_processes?: { argv?: string[]; name?: string; pid?: number }[]
}

/** a workspace's place in a herdr worktree group: a repo's own checkout, or a linked worktree nested under it */
interface WorktreeOf {
  checkout_path: string
  is_linked_worktree: boolean
  repo_root: string
}

export interface WorkspaceInfo {
  workspace_id: string
  label: string
  focused?: boolean
  tab_count?: number
  pane_count?: number
  worktree?: WorktreeOf
}

interface PaneInfo {
  pane_id: string
  workspace_id: string
  tab_id?: string
  cwd?: string | null
  foreground_cwd?: string | null
}

/** the workspace a worktree's space nests under, or the repo folder herdr finds (or opens) one for */
export type WorktreeFrom = { workspace_id: string } | { cwd: string }

/** what herdr gives back when it creates or opens a worktree workspace */
export interface WorktreeSpace {
  workspace: WorkspaceInfo
  root_pane: { pane_id: string }
  worktree?: { path: string }
  already_open?: boolean
}

export type Call = <T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>

/** herdr's command line, for what the socket API has no call for (the saved machines, a command's help): its stdout and
 *  stderr, or undefined when herdr is missing */
export async function herdrCli(args: string[], timeoutMs = 20_000): Promise<{ out: string; err: string } | undefined> {
  try {
    const p = Bun.spawn(['herdr', ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: timeoutMs, killSignal: 'SIGKILL' })
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
    return { out, err }
  } catch {
    return undefined
  }
}

export const herdr = adapter(rpc)

export function adapter(rpc: Call) {
  return {
    ping: () => rpc<{ version?: string; protocol?: number }>('ping', {}, 3000),
    agents: () => rpc<{ agents: AgentInfo[] }>('agent.list').then((r) => r.agents),
    /** the whole session in one answer; its agents are what the server keeps current from events after it */
    snapshot: () => rpc<{ snapshot: { agents: AgentInfo[] } }>('session.snapshot').then((r) => r.snapshot.agents),
    agent: (target: string) => rpc<{ agent: AgentInfo }>('agent.get', { target }).then((r) => r.agent),
    workspaces: () => rpc<{ workspaces: WorkspaceInfo[] }>('workspace.list').then((r) => r.workspaces),
    createWorkspace: (label: string, cwd: string, env: Record<string, string> = {}) =>
      rpc<{ workspace: WorkspaceInfo; root_pane: { pane_id: string } }>('workspace.create', { label, cwd, env, focus: false }),
    renameWorkspace: (workspace_id: string, label: string) => rpc('workspace.rename', { workspace_id, label }),
    createTab: (workspace_id: string, label: string, cwd: string, env: Record<string, string> = {}) =>
      rpc<{ tab: { tab_id: string }; root_pane: { pane_id: string } }>('tab.create', { workspace_id, label, cwd, env, focus: false }),
    start: (name: string, kind: string, pane_id: string, args: string[] = []) =>
      rpc<{ agent: AgentInfo }>('agent.start', { name, kind, pane_id, args, timeout_ms: 60_000 }, 70_000),
    rename: (target: string, name: string) => rpc('agent.rename', { target, name }),
    prompt: (target: string, text: string) => rpc('agent.prompt', { target, text }, 20_000),
    sendKeys: (target: string, keys: string[]) => rpc('agent.send_keys', { target, keys }),
    paneKeys: (pane_id: string, keys: string[]) => rpc('pane.send_keys', { pane_id, keys }),
    paneText: (pane_id: string, text: string) => rpc('pane.send_text', { pane_id, text }),
    read: (pane_id: string, format: 'ansi' | 'text' = 'ansi', lines = 200) =>
      rpc<{ read?: { text: string }; text?: string }>('pane.read', { pane_id, source: 'recent', format, lines, strip_ansi: format !== 'ansi' }).then(
        (r) => r.read?.text ?? r.text ?? '',
      ),
    /** what the pane shows right now, plain: unlike a deep read it never scrolls a working agent's view */
    visible: (pane_id: string) =>
      rpc<{ read?: { text: string }; text?: string }>('pane.read', { pane_id, source: 'visible', format: 'text', strip_ansi: true }).then(
        (r) => r.read?.text ?? r.text ?? '',
      ),
    /** a pane's size in cells */
    size: (pane_id: string) =>
      rpc<{ layout: { panes: { pane_id: string; rect: { width: number; height: number } }[] } }>('pane.layout', { pane_id }).then((r) => {
        const rect = r.layout.panes.find((p) => p.pane_id === pane_id)?.rect
        return rect ? { cols: rect.width, rows: rect.height } : null
      }),
    panes: (workspace_id: string) => rpc<{ panes: PaneInfo[] }>('pane.list', { workspace_id }).then((r) => r.panes),
    tabs: (workspace_id: string) => rpc<{ tabs: { tab_id: string; label: string; pane_count?: number }[] }>('tab.list', { workspace_id }).then((r) => r.tabs),
    /** what runs in a pane: its shell, and the processes in its foreground with their command lines */
    processInfo: (pane_id: string) => rpc<{ process_info: ProcessInfo }>('pane.process_info', { pane_id }).then((r) => r.process_info),
    /** the shell sits at its prompt: nothing runs in the foreground */
    paneIdle: (pane_id: string) =>
      rpc<{ process_info: { shell_pid?: number; foreground_process_group_id?: number } }>('pane.process_info', { pane_id }).then(
        (r) => !!r.process_info.shell_pid && r.process_info.foreground_process_group_id === r.process_info.shell_pid,
      ),
    /** a checkout on a new (or existing) branch, opened as a workspace nested under `from`: the repo's own workspace, or
     *  the one herdr finds (or opens) for the repo's folder. path: where (herdr picks one when it is left out) */
    worktreeCreate: (from: WorktreeFrom, branch: string, base: string, label: string, path?: string) =>
      rpc<WorktreeSpace>('worktree.create', { ...from, branch, base, label, ...(path ? { path } : {}), focus: false }, 120_000),
    /** an existing checkout as a workspace nested under `from` (the one already open, if it is) */
    worktreeOpen: (from: WorktreeFrom, path: string, label: string) => rpc<WorktreeSpace>('worktree.open', { ...from, path, label, focus: false }, 60_000),
    /** git worktree remove of a linked worktree's workspace, which closes it; never forced, never the branch */
    worktreeRemove: (workspace_id: string, force = false) => rpc('worktree.remove', { workspace_id, force }, 120_000),
    closePane: (pane_id: string) => rpc('pane.close', { pane_id }),
    closeWorkspace: (workspace_id: string) => rpc('workspace.close', { workspace_id }),
    notify: (title: string, body: string) => rpc('notification.show', { title, body }).catch(() => undefined),
  }
}

export type HerdrEvent = { event: string; data: Record<string, unknown> }

/** the events that change what the agents are: a pane made, updated, moved, exited or closed, an agent found in one, and a
 *  status change of each agent's pane (herdr takes a status subscription only for a named pane, and refuses the whole
 *  list over one it can't take) */
export const paneEvents = (agentPanes: string[]) => [
  { type: 'pane.created' },
  { type: 'pane.updated' },
  { type: 'pane.exited' },
  { type: 'pane.moved' },
  { type: 'pane.closed' },
  { type: 'pane.agent_detected' },
  ...[...new Set(agentPanes)].sort().map((pane_id) => ({ type: 'pane.agent_status_changed', pane_id })),
]

/**
 * One connection that streams the events it was asked for, rebuilt only when it drops (herdr closes a subscriber that
 * falls behind, with `events_lost`) or when its list changes: herdr closes a connection that is asked a second time.
 * `planned` tells the open that follows `set` (callers read just before it) from one that follows a drop.
 */
class Link {
  private sock: Conn | null = null
  private stopped = false
  private retry?: ReturnType<typeof setTimeout>
  private handshake?: ReturnType<typeof setTimeout>
  private recovery = new LinkBackoff()
  private wanted: Record<string, unknown>[] = []
  constructor(
    private onEvent: (e: HerdrEvent) => void,
    private onOpen: (planned: boolean) => void = () => undefined,
    private connect: () => Conn = () => open(socketPath()),
    private onDown: () => void = () => undefined,
  ) {}
  private planned = false

  set(subs: Record<string, unknown>[]) {
    const same = JSON.stringify(subs) === JSON.stringify(this.wanted)
    this.wanted = subs
    if (same) return
    this.planned = true
    this.reopen()
  }

  private reopen() {
    if (this.retry) clearTimeout(this.retry)
    if (this.handshake) clearTimeout(this.handshake)
    const previous = this.sock
    this.sock = null
    previous?.destroy()
    if (this.stopped || !this.wanted.length) return
    let sock: Conn
    try {
      sock = this.connect()
    } catch {
      this.planned = false
      this.onDown()
      this.retry = setTimeout(() => this.reopen(), this.recovery.fail())
      return
    }
    this.sock = sock
    let opened = false
    sock.on('connect', () => {
      sock.write(`${JSON.stringify({ id: `sub-${++n}`, method: 'events.subscribe', params: { subscriptions: this.wanted } })}\n`)
    })
    const read = lineReader((line) => {
      try {
        const f = JSON.parse(line)
        if (f.error) {
          again()
          return false
        }
        if (!opened && ('result' in f || f.event)) {
          opened = true
          if (this.handshake) clearTimeout(this.handshake)
          this.recovery.success()
          const planned = this.planned
          this.planned = false
          this.onOpen(planned)
        }
        if (f.event) this.onEvent(f as HerdrEvent)
      } catch {
        /* a frame we can't read */
      }
    })
    sock.on('data', (d) => {
      if (this.sock !== sock || this.stopped) return
      read(d)
    })
    const again = () => {
      if (this.sock !== sock || this.stopped) return
      this.sock = null
      this.planned = false
      if (this.handshake) clearTimeout(this.handshake)
      sock.destroy()
      this.onDown()
      this.retry = setTimeout(() => this.sock === null && this.reopen(), this.recovery.fail())
    }
    this.handshake = setTimeout(again, 15_000)
    sock.on('error', again)
    sock.on('close', again)
  }

  stop() {
    this.stopped = true
    if (this.handshake) clearTimeout(this.handshake)
    if (this.retry) clearTimeout(this.retry)
    this.sock?.destroy()
    this.sock = null
  }
}

/**
 * The events of `paneEvents`: one held connection for the events of every pane, never rebuilt when a pane starts or
 * ends, and one small connection for each agent pane's status, which herdr takes only for a named pane. A pane
 * that starts adds its own connection; none else is touched. `onOpen(planned)` is as in `Link`; a pane's first open is
 * planned, since its callers read just before the `set`.
 */
export class Subscription {
  private main: Link
  private panes = new Map<string, Link>()
  private stopped = false
  constructor(
    private onEvent: (e: HerdrEvent) => void,
    private onOpen: (planned: boolean) => void = () => undefined,
    private connect: () => Conn = () => open(socketPath()),
    private onDown: () => void = () => undefined,
  ) {
    this.main = this.link()
  }

  /** a pane's own connection that fails (herdr refuses a pane that is gone) does not mark all of herdr down: it tries
   *  again by itself, and its open after a drop makes the callers read the session */
  private link(pane = false) {
    return new Link(this.onEvent, this.onOpen, this.connect, pane ? () => undefined : this.onDown)
  }

  set(subs: Record<string, unknown>[]) {
    if (this.stopped) return
    const scoped = new Map(subs.filter((s) => typeof s.pane_id === 'string').map((s) => [s.pane_id as string, s]))
    this.main.set(subs.filter((s) => !scoped.has(s.pane_id as string)))
    for (const [pane, link] of this.panes)
      if (!scoped.has(pane)) {
        link.stop()
        this.panes.delete(pane)
      }
    for (const [pane, sub] of scoped) {
      if (this.panes.has(pane)) continue
      const link = this.link(true)
      this.panes.set(pane, link)
      link.set([sub])
    }
  }

  stop() {
    this.stopped = true
    this.main.stop()
    for (const link of this.panes.values()) link.stop()
    this.panes.clear()
  }
}
