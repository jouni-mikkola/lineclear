import { randomUUID } from 'node:crypto'
import { mkdirSync, openSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Chat } from '../../shared/types.ts'
import { HOME, writeJson } from '../store.ts'
import { boxInfo, helperVersion, installHelper, lacks, machineStatus, probe, savedMachines, type Probe, type Saved } from './install.ts'
import { MERGE_DEADLINE } from './engine/engine.ts'
import type { Kept } from './kept.ts'
import { LinkPoll, workerRecord } from './link-poll.ts'
import { CONNECTING_FOR, type Link, dirOf, fits, machineHome, sameBox, workerHome } from './machines-helpers.ts'
import { codeVersion, readAddress, running, type Worker } from './worker-process.ts'

export class MachinesLinks extends LinkPoll {
  constructor(
    protected saved: (() => Promise<Saved[]>) | null = savedMachines,
    protected status: typeof machineStatus = machineStatus,
  ) {
    super()
  }

  protected timers: NodeJS.Timeout[] = []

  /** this server stops: the workers go on (the next start takes them back), and what each machine showed is kept */
  stop() {
    this.stopped = true
    this.timers.forEach(clearInterval)
    for (const l of this.links.values()) {
      clearTimeout(l.retryTimer)
      l.ws?.close()
      this.keep(l, true)
    }
  }

  /** a machine as it was before a restart: shown as connecting, its worker taken back when its code is the same */
  protected resume(k: Kept) {
    if (k.saved.enabled === false) return
    const l = this.links.get(k.saved.label) ?? this.link(k.saved)
    l.probe = k.probe
    for (const c of k.chats ?? []) l.chats.set(c.key, c)
    const was = workerRecord(k.saved.label)
    const w = running(was.pid, was.token)
    if (!w) return
    if (was.port && was.code === codeVersion()) {
      this.own(l, w)
      l.rec.url = `http://127.0.0.1:${was.port}`
      l.state = 'Connecting…'
      void this.poll(l)
      // a newer helper goes there meanwhile, without stopping the worker
      void this.refresh(l)
      return
    }
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
        writeJson(join('machines', dirOf(l.rec.machine), 'last.json'), { saved: l.saved, probe: l.probe, chats } satisfies Kept)
      } catch (e) {
        console.error((e as Error).message)
      }
    }
    const t = this.keepTimers.get(l.rec.machine)
    if (now) {
      if (t) clearTimeout(t)
      return write()
    }
    if (!t) this.keepTimers.set(l.rec.machine, setTimeout(write, 5000))
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
          clearTimeout(this.keepTimers.get(label))
          this.keepTimers.delete(label)
          clearTimeout(l.retryTimer)
          l.ws?.close()
          const rec = workerRecord(label)
          const worker = l.worker ?? running(rec.pid, rec.token)
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
    const home = workerHome(l.saved.label)
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
    } catch (e) {
      console.error(`Can't look at ${l.rec.machine} again: ${(e as Error).message}`)
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
    if (force || p.helper !== helperVersion()) {
      if (!l.worker) l.state = 'Putting the helper there…'
      this.emit('snapshot')
      p.helper = await installHelper(l.saved.target, p)
      if (!this.active(l)) return null
    }
    this.keep(l)
    return p
  }

  protected async spawn(l: Link, p: Probe, home: string) {
    if (!this.active(l)) return
    const box = boxInfo(l.saved, p)
    // a worker left from before (another version of the code): one worker per machine
    const was = workerRecord(l.saved.label)
    const prior = running(was.pid, was.token)
    if (prior) {
      prior.kill()
      await prior.exited
    }
    if (!this.active(l)) return
    rmSync(join(home, 'server.json'), { force: true })
    l.rec.url = ''
    const logFile = join(home, 'worker.log')
    const log = openSync(logFile, 'a')
    const w = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'main.ts')], {
      env: {
        ...process.env,
        LINECLEAR_BOX: JSON.stringify(box),
        LINECLEAR_HOME: home,
        LINECLEAR_MACHINE: box.label,
        LINECLEAR_PORT: '0',
        LINECLEAR_TOKEN: randomUUID(),
        LINECLEAR_MAIN_HOME: HOME,
        LINECLEAR_SHARED_HOME: HOME,
      },
      stdout: 'pipe',
      stderr: log,
    })
    this.own(l, w)
    void readAddress(w.stdout, logFile, (port) => {
      if (l.worker !== w) return
      l.rec.url = `http://127.0.0.1:${port}`
      void this.poll(l)
    })
  }
}
