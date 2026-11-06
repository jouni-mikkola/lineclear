import { join } from 'node:path'
import type { Driver, FrameMeta } from '../../shared/browser.ts'
import { ROOT } from '../root.ts'
import { BOX, helperDir } from './box.ts'
import { boxDir } from './mfs.ts'

/** agent-browser keeps Lineclear's sessions apart from any of your own */
const NAMESPACE = 'lineclear'

/** the agent-browser command at the pinned version (bin/agent-browser picks the package's binary) */
export const browserBin = () => process.env.LINECLEAR_AGENT_BROWSER ?? join(BOX ? helperDir(BOX.home) : ROOT, 'bin', 'agent-browser')

/** a task's id (SHE-61): the only session names Lineclear closes or forgets. agent-browser takes any name, so one an
 *  agent made up ("..") must never lead the clean-up to a folder that is not a task's own profile */
export const isTaskId = (s: string) => /^[A-Za-z0-9]+-\d+$/.test(s)

/** where a task's browser keeps its sign-ins between restarts */
const profileOf = (task: string) => join(boxDir(), 'browser', task)

/** the environment that puts every agent-browser command in a task's terminal on its shared browser */
export function browserEnv(task: string): Record<string, string> {
  return { AGENT_BROWSER_NAMESPACE: NAMESPACE, AGENT_BROWSER_SESSION: task, AGENT_BROWSER_PROFILE: profileOf(task) }
}

/** the file each agent command touches (bin/agent-browser): when it last used its browser */
export const usedMark = (profile: string) => `${profile}.used`

export interface BrowserClient {
  send(s: string): void
  close(): void
  /** bytes waiting to go out: frames are skipped for a screen that can't keep up */
  buffered?(): number
}

export interface BrowserBridge {
  message(raw: string): void
  end(): void
}

export interface BrowsersOpts {
  bin?: string
  /** the session's environment (the demo keeps its own namespace and profiles) */
  env?: (task: string) => Record<string, string>
  /** a quiet line to the task's agent (it took over / handed back) */
  tell(task: string, text: string): void
  /** the task's agent is in a turn */
  working(task: string): boolean
  /** how long the task's browser may sit idle before it closes (ms); null: it stays */
  idleClose?(task: string): number | null
  user(): string
  host: string
}

export type Run = { ok: boolean; data?: Record<string, unknown>; error?: string }

/** agent-browser's word for a session's daemon started by another version (or settings) meanwhile */
export const CLASH = /different daemon configuration/i

export const LEAVE_MS = 60_000
export const IDLE_MS = 5000
/** frames are skipped for a screen this far behind */
export const BEHIND = 2_000_000

export interface Hub {
  task: string
  clients: Set<BrowserClient>
  up?: WebSocket
  cdp?: Cdp
  starting?: Promise<void>
  driver: Driver
  /** the agent was told you took over (so it hears when you hand back) */
  told: boolean
  url: string
  title: string
  target: string
  connected: boolean
  viewport: { w: number; h: number }
  meta?: FrameMeta
  /** last frame, for a screen that joins */
  frame?: string
  agentAt: number
  /** commands this server runs itself are not the agent driving */
  own: number
  ownUntil: number
  hovering: boolean
  /** closed with its task: a start under way stops short */
  gone?: boolean
  /** when the last screen stopped watching (or you used it) */
  seenAt: number
  leave?: ReturnType<typeof setTimeout>
  idle?: ReturnType<typeof setTimeout>
  stateTimer?: ReturnType<typeof setTimeout>
  /** on another machine: the SSH forwards to its stream and its DevTools */
  fwd?: { port: number; close(): void }
  cdpFwd?: { port: number; remote: number; close(): void }
  /** on another machine: its stream shared on the tailnet from there (relay.pl and tailscale serve) */
  share?: { url: string; stop(): void; proc: unknown }
  sharing?: boolean
  /** panels that take frames straight from there */
  direct: Set<BrowserClient>
}

/** a Chrome process in a task's profile, and how long it has run (ms) */
export type Chrome = { pid: number; task: string; age: number }

/** from ps's pid, elapsed time and command lines, the processes started with a profile under flag's folder, with that
 *  profile's task */
export function chromesIn(ps: string, flag: string): Chrome[] {
  const out: Chrome[] = []
  for (const l of ps.split('\n')) {
    const m = l.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/)
    const at = m ? m[3].indexOf(flag) : -1
    if (!m || at < 0) continue
    const task = m[3].slice(at + flag.length).split(' ')[0]
    if (isTaskId(task)) out.push({ pid: Number(m[1]), task, age: elapsed(m[2]) })
  }
  return out
}

/** ps's elapsed time, [[dd-]hh:]mm:ss (Linux and macOS alike), in ms */
function elapsed(s: string) {
  const [d, rest] = s.includes('-') ? s.split('-') : ['0', s]
  const parts = rest.split(':').map(Number)
  while (parts.length < 3) parts.unshift(0)
  const ms = ((Number(d) * 24 + parts[0]) * 3600 + parts[1] * 60 + parts[2]) * 1000
  return Number.isFinite(ms) ? ms : 0
}

/** a DevTools connection to the session's browser, with one flattened session per page */
export class Cdp {
  private n = 0
  private pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>()
  private attached = new Map<string, Promise<string>>()
  closed = false

  private constructor(private ws: WebSocket) {
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as {
        id?: number
        result?: unknown
        error?: { message: string }
        method?: string
        params?: { targetId?: string; sessionId?: string }
      }
      if (m.id !== undefined) {
        const p = this.pending.get(m.id)
        this.pending.delete(m.id)
        if (m.error) p?.rej(new Error(m.error.message))
        else p?.res(m.result)
      } else if (m.method === 'Target.detachedFromTarget') {
        for (const [t, s] of this.attached) s.then((id) => id === m.params?.sessionId && this.attached.delete(t)).catch(() => undefined)
      }
    }
    ws.onclose = () => {
      this.closed = true
      for (const p of this.pending.values()) p.rej(new Error('The browser closed.'))
      this.pending.clear()
    }
  }

  static open(url: string) {
    return new Promise<Cdp>((res, rej) => {
      const ws = new WebSocket(url)
      const t = setTimeout(() => (ws.close(), rej(new Error('The browser did not answer.'))), 5000)
      ws.onopen = () => (clearTimeout(t), res(new Cdp(ws)))
      ws.onerror = () => (clearTimeout(t), rej(new Error('The browser did not answer.')))
    })
  }

  call(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('The browser closed.'))
    const id = ++this.n
    return new Promise((res, rej) => {
      const t = setTimeout(() => {
        this.pending.delete(id)
        rej(new Error(`The browser took too long (${method}).`))
      }, 10_000)
      this.pending.set(id, { res: (v) => (clearTimeout(t), res(v)), rej: (e) => (clearTimeout(t), rej(e)) })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  attach(targetId: string) {
    let s = this.attached.get(targetId)
    if (!s) {
      s = this.call('Target.attachToTarget', { targetId, flatten: true }).then((r) => (r as { sessionId: string }).sessionId)
      s.catch(() => this.attached.delete(targetId))
      this.attached.set(targetId, s)
    }
    return s
  }

  forget(targetId: string) {
    const s = this.attached.get(targetId)
    this.attached.delete(targetId)
    s?.then((sessionId) => this.call('Target.detachFromTarget', { sessionId })).catch(() => undefined)
  }

  close() {
    this.closed = true
    this.ws.close()
  }
}

/** the first line a process prints */
export async function readLine(out: ReadableStream<Uint8Array>) {
  const r = out.getReader()
  let s = ''
  while (!s.includes('\n')) {
    const { done, value } = await r.read()
    if (done) break
    s += new TextDecoder().decode(value)
  }
  r.releaseLock()
  return s.split('\n')[0].trim()
}
