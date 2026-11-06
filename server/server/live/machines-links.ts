import { WorkerHealth } from './recovery.ts'
import { mkdirSync, openSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Action, Chat, Snapshot } from '../../shared/types.ts'
import { Emitter } from '../source.ts'
import { HOME, readJson, writeJson } from '../store.ts'
import {
  boxInfo,
  browserVersion,
  helperVersion,
  installHelper,
  lacks,
  machineStatus,
  onMachine,
  probe,
  savedMachines,
  type Probe,
  type Saved,
} from './install.ts'
import { mirrorHomes } from './mirror.ts'
import { q, tellRunBy } from './box.ts'
import { MERGE_DEADLINE } from './engine/engine.ts'
import { type Events, type Link, type Worker, type Kept, CONNECTING_FOR, codeVersion, running, machineHome, dirOf, fits, sameBox } from './machines-helpers.ts'

export class MachinesLinks extends Emitter<Events> {
  constructor(
    protected saved: (() => Promise<Saved[]>) | null = savedMachines,
    protected status: typeof machineStatus = machineStatus,
  ) {
    super()
  }

  protected links = new Map<string, Link>()
  protected timers: ReturnType<typeof setInterval>[] = []
  protected stopped = false
  protected pendingResume = new Map<string, Kept>()

  /** this server stops: the workers go on (the next start takes them back), and what each machine showed is kept */
  stop() {
    this.stopped = true
    this.timers.forEach(clearInterval)
    for (const l of this.links.values()) {
      l.ws?.close()
      this.keep(l, true)
    }
  }

  /** a machine as it was before a restart: shown as connecting, its worker taken back when its code is the same */
  protected resume(k: Kept) {
    if (k.saved.enabled === false) return
    const l = this.links.get(k.saved.label) ?? this.link(k.saved)
    l.probe = k.probe
    l.snap = k.snap
    for (const c of k.chats ?? []) l.chats.set(c.key, c)
    const was = readJson<{ port?: number; pid?: number; code?: string }>(join('machines', dirOf(k.saved.label), 'server.json'), {})
    const w = running(was.pid)
    if (w && was.port && was.code === codeVersion()) {
      this.own(l, w)
      l.rec.url = `http://127.0.0.1:${was.port}`
      l.state = 'Connecting…'
      void this.poll(l)
      // a newer helper goes there meanwhile, without stopping the worker
      void this.refresh(l)
      return
    }
    if (!w) return
    // its old worker finishes a merge on its way first (main.ts): the new one starts once it is gone, never beside it
    l.busy = true
    w.kill()
    void Promise.race([w.exited, Bun.sleep(MERGE_DEADLINE + 30_000)]).then(() => {
      l.busy = false
      if (this.active(l)) void this.start(l)
    })
  }

  protected link(m: Saved): Link {
    const l: Link = {
      rec: { machine: m.label, url: '', lastSeen: 0 },
      saved: m,
      chats: new Map(),
      watching: { chats: [], term: null },
      reachable: false,
      waiting: [],
      state: 'Connecting…',
      lacks: [],
      connecting: true,
      health: new WorkerHealth(),
    }
    this.links.set(m.label, l)
    setTimeout(() => {
      if (!this.active(l) || !l.connecting) return
      l.connecting = false
      this.emit('snapshot')
    }, CONNECTING_FOR)
    return l
  }

  /** what a machine shows is kept on disk, a few seconds after it changes (at once as this server stops) */
  protected keepTimers = new Map<string, ReturnType<typeof setTimeout>>()
  protected keep(l: Link, now = false) {
    if (!this.saved || (!now && !this.active(l))) return
    const write = () => {
      this.keepTimers.delete(l.rec.machine)
      if (this.links.get(l.saved.label) !== l || l.saved.enabled === false) return
      const chats = l.watching.chats.map((k) => l.chats.get(k)).filter((c): c is Chat => !!c)
      try {
        writeJson(join('machines', dirOf(l.rec.machine), 'last.json'), { saved: l.saved, probe: l.probe, snap: l.snap, chats } satisfies Kept)
      } catch {
        /* a full disk: the next start shows it once it answers */
      }
    }
    const t = this.keepTimers.get(l.rec.machine)
    if (now) {
      if (t) clearTimeout(t)
      return write()
    }
    if (!t) this.keepTimers.set(l.rec.machine, setTimeout(write, 5000))
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
    })
  }

  list() {
    return [...this.links.values()]
  }

  protected syncing = false

  /** the machines herdr has saved: a new one is set up and started, a removed one stopped */
  async sync() {
    if (this.stopped || !this.saved || this.syncing) return
    this.syncing = true
    try {
      const saved = await this.saved()
      const status = await this.status()
      if (this.stopped) return
      for (const m of saved.filter((m) => m.enabled !== false)) {
        let l = this.links.get(m.label)
        if (!l) {
          l = this.link(m)
          this.emit('snapshot')
        }
        l.saved = m
        const pending = this.pendingResume.get(m.label)
        if (pending) {
          this.pendingResume.delete(m.label)
          this.resume({ ...pending, saved: m })
        }
        const st = status[m.label]
        if (st && st.status !== 'reachable' && !l.worker) {
          l.state = `herdr can't reach it: ${st.error ?? st.status}`
          l.connecting = false
          this.emit('snapshot')
          continue
        }
        if (!l.worker && !l.busy) void this.start(l)
      }
      for (const [label, l] of this.links)
        if (!saved.some((m) => m.label === label && m.enabled !== false)) {
          this.pendingResume.delete(label)
          const pending = this.keepTimers.get(label)
          if (pending) clearTimeout(pending)
          this.keepTimers.delete(label)
          l.ws?.close()
          const worker = l.worker ?? running(readJson<{ pid?: number }>(join('machines', dirOf(label), 'server.json'), {}).pid)
          worker?.kill()
          this.links.delete(label)
          rmSync(join(machineHome(label), 'last.json'), { force: true })
          this.emit('snapshot')
        }
    } finally {
      this.syncing = false
    }
  }

  /** a worker that already runs, at this address (tests) */
  adopt(label: string, url: string) {
    const l = this.link({ id: label, label, target: label, session: 'default', enabled: true })
    l.rec.url = url.replace(/\/+$/, '')
    void this.poll(l)
    return l
  }

  /** check the machine, put the helper there when it lacks it or it is older, then start its worker; when nothing
   *  changed there since the last look, the worker starts at once and the look follows */
  async start(l: Link, force = false) {
    if (!this.active(l) || l.busy || l.worker) return
    l.busy = true
    const home = machineHome(l.saved.label)
    mkdirSync(home, { recursive: true })
    const last = !force && l.probe && fits(l.probe) ? l.probe : undefined
    try {
      if (last) {
        await this.spawn(l, last, home)
        l.state = 'Starting…'
      }
      const p = await this.look(l, force)
      if (!p || !this.active(l)) return
      if (last && l.worker && sameBox(l.saved, last, p)) return
      if (l.worker) {
        const old = l.worker as Worker
        old.kill()
        await old.exited
        if (!this.active(l)) return
      }
      await this.spawn(l, p, home)
      l.state = 'Starting…'
    } catch (e) {
      l.state = `Can't reach it: ${(e as Error).message}`
      l.connecting = false
    } finally {
      l.busy = false
      this.emit('snapshot')
    }
  }

  /** a worker taken back after a restart: the machine is looked at again and gets a newer helper, the worker goes on */
  protected async refresh(l: Link) {
    if (l.busy) return
    l.busy = true
    try {
      await this.look(l)
    } catch {
      /* the next restart or the doctor looks again */
    } finally {
      l.busy = false
      this.emit('snapshot')
    }
  }

  /** look at the machine, and put the helper there when it lacks it or it is older: null when it lacks a tool */
  protected async look(l: Link, force = false): Promise<Probe | null> {
    const p = await probe(l.saved.target)
    if (!this.active(l)) return null
    l.probe = p
    l.lacks = lacks(p)
    if (l.lacks.length) {
      l.state = `Needs ${l.lacks.join(', ')}`
      l.connecting = false
      return null
    }
    if (force || p.helper !== helperVersion(p.os, p.arch)) {
      if (!l.worker) l.state = 'Putting the helper there…'
      this.emit('snapshot')
      p.helper = await installHelper(l.saved.target, p)
      if (!this.active(l)) return null
      p.browser = browserVersion(p.os, p.arch)
      // Chrome for the shared browser, by the helper's agent-browser (nothing to do when it is there)
      void onMachine(l.saved.target, `${q(join(p.home, '.lineclear', 'helper', 'bin', 'agent-browser'))} install`, { timeoutMs: 600_000 }).then((r) => {
        l.chrome = r.code === 0 ? undefined : `Chrome didn't install there: ${r.err.split('\n').pop() || r.out.trim().split('\n').pop()}`
      })
    }
    tellRunBy(l.saved.target)
    this.keep(l)
    return p
  }

  protected active(l: Link) {
    return !this.stopped && !this.pendingResume.has(l.saved.label) && l.saved.enabled !== false && this.links.get(l.saved.label) === l
  }

  protected async spawn(l: Link, p: Probe, home: string) {
    if (!this.active(l)) return
    const box = boxInfo(l.saved, p)
    // a worker left from before (another version of the code): one worker per machine
    const prior = running(readJson<{ pid?: number }>(join('machines', dirOf(l.saved.label), 'server.json'), {}).pid)
    if (prior) {
      prior.kill()
      await prior.exited
    }
    if (!this.active(l)) return
    rmSync(join(home, 'server.json'), { force: true })
    l.rec.url = ''
    const log = openSync(join(home, 'worker.log'), 'a')
    const w = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'main.ts')], {
      env: {
        ...process.env,
        ...mirrorHomes(home, box),
        LINECLEAR_BOX: JSON.stringify(box),
        LINECLEAR_HOME: home,
        LINECLEAR_MACHINE: box.label,
        LINECLEAR_PORT: '0',
        LINECLEAR_MAIN_HOME: HOME,
        LINECLEAR_SHARED_HOME: HOME,
      },
      stdout: log,
      stderr: log,
    })
    this.own(l, w)
    // its address, once it serves
    const look = setInterval(() => {
      const port = readJson<{ port?: number }>(join('machines', dirOf(l.saved.label), 'server.json'), {}).port
      if (!port || l.worker !== w) return
      clearInterval(look)
      l.rec.url = `http://127.0.0.1:${port}`
      void this.poll(l)
    }, 300)
    setTimeout(() => clearInterval(look), 60_000)
  }

  protected async pollAll() {
    await Promise.all([...this.links.values()].map((l) => this.poll(l)))
  }

  protected async poll(l: Link): Promise<void> {
    if (!this.active(l) || l.polling) return
    if (!l.rec.url && !this.moved(l)) {
      l.health.observe(false)
      if (l.worker && !l.busy && l.health.restartDue()) void this.restartUnhealthy(l)
      return
    }
    l.polling = true
    try {
      const r = await fetch(`${l.rec.url}/api/snapshot`, { signal: AbortSignal.timeout(4000) })
      if (!r.ok) throw new Error(String(r.status))
      const snap = (await r.json()) as Snapshot
      if (!this.active(l)) return
      l.snap = snap
      l.rec.lastSeen = Date.now()
      const herdrUp = !!l.snap.machines?.length && !l.snap.machines.some((m) => m.status === 'off')
      l.health.observe(herdrUp)
      l.state = herdrUp ? 'Ready' : "Its herdr isn't answering"
      l.connecting = false
      this.keep(l)
      if (!herdrUp) {
        l.reachable = false
        l.down ??= Date.now()
        this.emit('snapshot')
        return
      }
      // a worker started again: the live link is made again
      if (!l.reachable || !l.ws) {
        l.reachable = true
        l.down = undefined
        this.connect(l)
        // what waited goes in now
        const queued = l.waiting.splice(0)
        for (const a of queued) await this.forward(l, a).catch(() => l.waiting.push(a))
      }
      this.emit('snapshot')
    } catch {
      if (!this.active(l)) return
      l.health.observe(false)
      if (this.moved(l)) return
      if (l.reachable || l.down === undefined) {
        l.reachable = false
        l.down = l.down ?? Date.now()
        this.emit('snapshot')
      }
    } finally {
      l.polling = false
      if (this.active(l) && l.worker && !l.busy && l.health.restartDue()) void this.restartUnhealthy(l)
    }
  }

  /** Replace only our local worker; never stop remote herdr, panes or agents. */
  protected async restartUnhealthy(l: Link) {
    if (!this.active(l) || l.busy || !l.worker) return
    l.busy = true
    l.health.restarting()
    console.info(`lineclear: ${l.rec.machine}: link unhealthy for 3 minutes; replacing worker`)
    const w = l.worker
    l.ws?.close()
    l.ws = undefined
    l.reachable = false
    try {
      w.kill()
      // Do not spawn beside a draining worker, even if it takes longer than expected.
      const force = setTimeout(() => {
        if (l.worker === w) w.kill('SIGKILL')
      }, MERGE_DEADLINE + 30_000)
      try {
        await w.exited
      } finally {
        clearTimeout(force)
      }
      if (l.worker === w) l.worker = undefined
    } finally {
      l.busy = false
    }
    if (this.active(l)) await this.start(l)
  }

  /** Its worker was started again out of this server's hands (lineclear doctor while another server ran, by hand)
   *  and serves at another address: its server.json says where, and that worker is taken as this machine's. */
  protected moved(l: Link): boolean {
    if (l.busy) return false
    const s = readJson<{ port?: number; pid?: number }>(join('machines', dirOf(l.saved.label), 'server.json'), {})
    const url = s.port ? `http://127.0.0.1:${s.port}` : ''
    if (!url || url === l.rec.url) return false
    const w = s.pid === l.worker?.pid ? l.worker : running(s.pid)
    if (!w) return false
    if (w !== l.worker) this.own(l, w)
    l.rec.url = url
    // the live link is made again at the new address on its first answer
    l.reachable = false
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
        l.snap = m.snapshot
        this.keep(l)
        this.emit('snapshot')
      } else if (m.type === 'alert') this.emit('alert', m.alert)
      else if (m.type === 'news') this.emit('news', l.rec.machine, m.news)
    }
    ws.onclose = () => {
      if (l.ws === ws) l.ws = undefined
    }
  }

  /* ---------- who owns what ---------- */

  /** the machine a place, task or chat key belongs to */
  owner(key: string): Link | undefined {
    const m = key.match(/^[mp]:([^:]+)/)
    if (m) return this.links.get(m[1])
    const task = key.split('/')[0]
    for (const l of this.links.values())
      if (l.snap?.tasks.some((t) => t.id.toUpperCase() === task.toUpperCase() || t.aliases?.some((a) => a.toUpperCase() === task.toUpperCase()))) return l
    return undefined
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

  protected screenWatch: { chats: string[]; term: string | null } = { chats: [], term: null }

  watch(chats: string[], term: string | null) {
    this.screenWatch = { chats, term }
    for (const l of this.links.values()) {
      const mine = chats.filter((k) => this.owner(k) === l)
      const t = term && this.owner(term) === l ? term : null
      const next = { chats: mine, term: t }
      if (JSON.stringify(next) === JSON.stringify(l.watching)) continue
      l.watching = next
      if (l.ws?.readyState === WebSocket.OPEN) l.ws.send(JSON.stringify({ type: 'watch', ...next, link: true }))
    }
  }
}
