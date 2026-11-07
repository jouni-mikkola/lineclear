import { join } from 'node:path'
import type { Action, Snapshot } from '../../shared/types.ts'
import { clock } from '../../shared/time.ts'
import { Emitter } from '../source.ts'
import { readJson } from '../store.ts'
import { boxInfo } from './install.ts'
import type { BoxInfo } from './box.ts'
import type { Kept } from './kept.ts'
import { type Events, type Link, dirOf } from './machines-helpers.ts'
import { running, type Worker } from './worker-process.ts'

/** what a worker says of itself in its server.json */
export const workerRecord = (label: string) => readJson<{ port?: number; pid?: number; code?: string }>(join('workers', dirOf(label), 'server.json'), {})

/** The links of the machines and the talk over them: the poll of each worker, its live link, the actions sent to it.
 *  Starting a worker is MachinesLinks'. */
export abstract class LinkPoll extends Emitter<Events> {
  protected links = new Map<string, Link>()
  protected stopped = false
  protected pendingResume = new Map<string, Kept>()

  abstract start(l: Link, force?: boolean): Promise<void>
  protected abstract keep(l: Link): void

  protected active(l: Link) {
    return !this.stopped && !this.pendingResume.has(l.saved.label) && l.saved.enabled !== false && this.links.get(l.saved.label) === l
  }

  protected own(l: Link, w: Worker) {
    l.worker = w
    w.exited.then(() => {
      if (l.worker !== w) return
      l.worker = undefined
      l.ws?.close()
      l.ws = undefined
      l.reachable = false
      l.rec.url = ''
      l.state = 'Its worker stopped; starting it again'
      this.emit('snapshot')
      // a worker started out of our hands may already serve elsewhere (moved)
      this.retry(l)
    })
  }

  list() {
    return [...this.links.values()]
  }

  /** whether herdr has this machine saved and enabled, looked at yet or not */
  knows(label: string) {
    return this.links.has(label)
  }

  /** the machines that have been looked at, as a worker is told of them (box.ts): where tasks may be placed */
  boxes(): BoxInfo[] {
    return [...this.links.values()].flatMap((l) => (l.probe ? [boxInfo(l.saved, l.probe)] : []))
  }

  /** One look at the worker's snapshot, then the live link: it carries every change after. A failed look or a closed
   *  link tries again later (retry), never on a clock beside an open link. */
  protected async poll(l: Link): Promise<void> {
    if (!this.active(l) || l.polling) return
    if (!l.rec.url && !this.moved(l)) {
      // no worker of ours: one may appear out of our hands until sync starts one; a starting worker says its own port
      if (!l.worker) this.retry(l)
      return
    }
    l.polling = true
    try {
      const r = await fetch(`${l.rec.url}/api/snapshot`, { signal: AbortSignal.timeout(4000) })
      if (!r.ok) throw new Error(String(r.status))
      const snap = (await r.json()) as Snapshot
      if (!this.active(l)) return
      l.rec.lastSeen = Date.now()
      l.connecting = false
      this.keep(l)
      // the socket is made even with herdr off: it says when herdr is back
      const herdrUp = this.seen(l, snap)
      this.connect(l)
      if (herdrUp) await this.flush(l)
      this.emit('snapshot')
    } catch {
      if (!this.active(l)) return
      if (!this.moved(l) && (l.reachable || l.down === undefined)) {
        l.reachable = false
        l.down ??= Date.now()
        this.emit('snapshot')
      }
      this.retry(l)
    } finally {
      l.polling = false
    }
  }

  /** what a snapshot says of the worker's herdr: whether the machine is up; the state shown follows */
  protected seen(l: Link, snap: Snapshot) {
    l.snap = snap
    const herdrUp = !!snap.machines?.length && !snap.machines.some((m) => m.status === 'off')
    l.state = herdrUp ? 'Ready' : "Its herdr isn't answering"
    if (herdrUp) {
      l.reachable = true
      l.down = undefined
    } else {
      l.reachable = false
      l.down ??= Date.now()
    }
    return herdrUp
  }

  /** what waited for the machine goes in now */
  protected async flush(l: Link) {
    for (const a of l.waiting.splice(0)) await this.forward(l, a).catch(() => l.waiting.push(a))
  }

  protected retryAfter = 3000

  /** a look again soon, so a lost link is back within seconds; one timer per link, never beside an open socket */
  protected retry(l: Link) {
    if (!this.active(l) || l.retryTimer) return
    l.retryTimer = setTimeout(() => {
      l.retryTimer = undefined
      void this.poll(l)
    }, this.retryAfter)
  }

  /** Its worker was started again out of this server's hands (lineclear doctor while another server ran, by hand)
   *  and serves at another address: its server.json says where, and that worker is taken as this machine's. */
  protected moved(l: Link): boolean {
    if (l.busy) return false
    const s = workerRecord(l.saved.label)
    const url = s.port ? `http://127.0.0.1:${s.port}` : ''
    if (!url || url === l.rec.url) return false
    const w = s.pid === l.worker?.pid ? l.worker : running(s.pid)
    if (!w) return false
    if (w !== l.worker) this.own(l, w)
    l.rec.url = url
    // the live link is made again at the new address on its next look
    l.reachable = false
    l.ws?.close()
    l.ws = undefined
    return true
  }

  protected connect(l: Link) {
    l.ws?.close()
    const url = new URL(`${l.rec.url}/api/ws`)
    url.protocol = url.protocol.replace('http', 'ws')
    const ws = new WebSocket(url)
    l.ws = ws
    ws.onopen = () => {
      if (this.active(l) && l.ws === ws) ws.send(JSON.stringify({ type: 'watch', ...l.watching, link: true }))
    }
    ws.onmessage = (e) => {
      if (!this.active(l) || l.ws !== ws) return
      const m = JSON.parse(String(e.data))
      if (m.type === 'chat') {
        l.chats.set(m.chat.key, m.chat)
        this.keep(l)
        this.emit('chat', m.chat.key, m.chat)
      } else if (m.type === 'terminal') this.emit('terminal', m.chat, { ansi: m.ansi, cols: m.cols, rows: m.rows })
      else if (m.type === 'snapshot') {
        const was = l.reachable
        l.connecting = false
        l.rec.lastSeen = Date.now()
        this.seen(l, m.snapshot)
        this.keep(l)
        this.emit('snapshot')
        if (l.reachable && !was) void this.flush(l)
      } else if (m.type === 'alert') this.emit('alert', m.alert)
      else if (m.type === 'news') this.emit('news', l.rec.machine, m.news)
    }
    ws.onclose = () => {
      if (l.ws !== ws) return
      l.ws = undefined
      // the next look says whether the worker is still there
      this.retry(l)
    }
  }

  /** a machine's tasks as it last showed them over the link; out of reach they stay, marked, and nothing is written */
  tasksOf(l: Link) {
    const tasks = l.snap?.tasks ?? []
    return l.reachable || l.connecting ? tasks : tasks.map((t) => ({ ...t, unreachableSince: clock(l.down ?? l.rec.lastSeen) }))
  }

  /** the machine a place, task or chat key belongs to */
  owner(key: string): Link | undefined {
    const m = key.match(/^[mp]:([^:]+)/)
    if (m) return this.links.get(m[1])
    const task = key.split('/')[0].toUpperCase()
    return [...this.links.values()].find((l) => l.snap?.tasks.some((t) => t.id.toUpperCase() === task || t.aliases?.some((a) => a.toUpperCase() === task)))
  }

  ownerOfAction(a: Action): Link | undefined {
    const k = 'chat' in a ? a.chat : 'place' in a ? a.place : undefined
    return k ? this.owner(k) : undefined
  }

  byName(machine: string) {
    return [...this.links.values()].find((l) => l.rec.machine.toLowerCase() === machine.toLowerCase())
  }

  async act(l: Link, a: Action): Promise<unknown> {
    if (!l.reachable) {
      l.waiting.push(a)
      return { waiting: true }
    }
    return this.forward(l, a)
  }

  protected async forward(l: Link, a: Action) {
    const r = await fetch(`${l.rec.url}/api/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(a),
      signal: AbortSignal.timeout(20_000),
    })
    return r.json()
  }

  watch(chats: string[], term: string | null) {
    for (const l of this.links.values()) {
      const next = { chats: chats.filter((k) => this.owner(k) === l), term: term && this.owner(term) === l ? term : null }
      if (JSON.stringify(next) === JSON.stringify(l.watching)) continue
      l.watching = next
      if (l.ws?.readyState === WebSocket.OPEN) l.ws.send(JSON.stringify({ type: 'watch', ...next, link: true }))
    }
  }
}
