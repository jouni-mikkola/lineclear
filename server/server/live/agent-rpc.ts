import { randomUUID } from 'node:crypto'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'

/** the pane id an RPC agent shows in the agent list: it has no pane, and nothing asks herdr about it */
export const rpcPane = (key: string) => `rpc:${key}`
export const isRpcPane = (pane?: string) => !!pane?.startsWith('rpc:')

/** the CLI an RPC agent runs: found on PATH, as herdr's panes find it */
const KIND = process.env.LINECLEAR_PI ?? 'pi'

interface MemoryCap {
  high: string
  max: string
}

/** an agent needs about 420 MB: past `high` it is slowed, past `max` the kernel kills it and nothing else */
const MEMORY_CAP: MemoryCap = { high: '450M', max: '700M' }

let systemdFound: boolean | undefined

/** true when a user scope can be made here; probed once, a machine without systemd runs agents plain */
export function hasSystemd(): boolean {
  systemdFound ??= spawnSync('systemd-run', ['--user', '--scope', '-q', 'true'], { stdio: 'ignore' }).status === 0
  return systemdFound
}

/** the command and argv of an RPC agent: inside a capped systemd scope when systemd is there, plain otherwise. Swap is off so the cap holds */
export function rpcCommand(args: string[], systemd = hasSystemd(), cap = MEMORY_CAP): [string, string[]] {
  const pi = ['--mode', 'rpc', ...args]
  if (!systemd) return [KIND, pi]
  return ['systemd-run', ['--user', '--scope', '-q', '-p', `MemoryHigh=${cap.high}`, '-p', `MemoryMax=${cap.max}`, '-p', 'MemorySwapMax=0', KIND, ...pi]]
}

const FIRST_EVENT_MS = 20_000

export interface RpcState {
  status: 'working' | 'idle'
  sessionFile?: string
}

type Line = { type?: string; aborted?: boolean; id?: string; success?: boolean; error?: string; data?: { disposition?: string; sessionFile?: string } }

/** one `pi --mode rpc` child: commands go in as JSON lines, events and answers come back the same way (pi's rpc.md) */
export class RpcAgent {
  readonly child: ChildProcessWithoutNullStreams
  status: RpcState['status'] = 'idle'
  /** the last agent_settled said the turn was stopped, not finished */
  aborted = false
  sessionFile?: string
  exited = false
  private buffer = ''
  private asked = new Map<string, { done: (r: Line) => void }>()
  /** resolves with the first record read, which is the answer to get_state sent at spawn */
  readonly firstEvent: Promise<void>

  constructor(
    args: string[],
    opts: { cwd: string; env: NodeJS.ProcessEnv },
    private on: { change: (a: RpcAgent) => void; exit: (a: RpcAgent) => void },
  ) {
    const [cmd, argv] = rpcCommand(args)
    this.child = spawn(cmd, argv, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.read(chunk))
    this.child.stderr.on('data', () => undefined)
    this.child.stdin.on('error', () => undefined)
    this.child.on('error', () => this.ended())
    this.child.on('exit', () => this.ended())
    this.firstEvent = this.ask({ type: 'get_state' }).then((r) => {
      this.sessionFile = r.data?.sessionFile
      this.on.change(this)
    })
    this.firstEvent.catch(() => undefined)
    // a pi that never answers must not hold its start for ever
    const silent = setTimeout(() => this.ended(), FIRST_EVENT_MS)
    silent.unref()
    void this.firstEvent.finally(() => clearTimeout(silent)).catch(() => undefined)
  }

  get pid() {
    return this.child.pid
  }

  /** one prompt; what pi did with it: started, queued or handled. Mid-turn it steers: pi takes it at its next step, as a pane's CLI does */
  async prompt(message: string): Promise<string> {
    const r = await this.ask({ type: 'prompt', message, streamingBehavior: 'steer' })
    if (!r.success) throw new Error(r.error ?? 'pi refused the prompt')
    return r.data?.disposition ?? 'started'
  }

  async abort() {
    await this.ask({ type: 'abort' }).catch(() => undefined)
  }

  stop() {
    this.child.stdin.end()
    this.child.kill()
  }

  private ask(command: { type: string; [k: string]: unknown }): Promise<Line> {
    if (this.exited) return Promise.reject(new Error('The agent process has ended.'))
    const id = randomUUID()
    return new Promise((done, fail) => {
      this.asked.set(id, { done: (r) => (r.success === false && command.type === 'get_state' ? fail(new Error(r.error)) : done(r)) })
      this.child.stdin.write(`${JSON.stringify({ id, ...command })}\n`)
    })
  }

  /** records are split on LF only: a JSON string may hold U+2028, which a line reader would cut */
  private read(chunk: string) {
    this.buffer += chunk
    for (let at = this.buffer.indexOf('\n'); at >= 0; at = this.buffer.indexOf('\n')) {
      const line = this.buffer.slice(0, at).replace(/\r$/, '')
      this.buffer = this.buffer.slice(at + 1)
      if (line) this.heard(line)
    }
  }

  private heard(line: string) {
    let rec: Line
    try {
      rec = JSON.parse(line)
    } catch {
      return
    }
    if (rec.type === 'response' && rec.id) {
      const a = this.asked.get(rec.id)
      this.asked.delete(rec.id)
      a?.done(rec)
      return
    }
    const next = rec.type === 'agent_start' ? 'working' : rec.type === 'agent_settled' ? 'idle' : undefined
    if (!next) return
    this.aborted = rec.type === 'agent_settled' && rec.aborted === true
    if (next === this.status) return
    this.status = next
    this.on.change(this)
  }

  private ended() {
    if (this.exited) return
    this.exited = true
    this.child.kill()
    for (const a of this.asked.values()) a.done({ success: false, error: 'The agent process has ended.' })
    this.asked.clear()
    this.on.exit(this)
  }
}
