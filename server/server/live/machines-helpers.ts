import type { WorkerHealth } from './recovery.ts'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Action, Alert, Chat, Snapshot, TermScreen } from '../../shared/types.ts'
import type { Overview } from '../source.ts'
import { HOME, readJson, writeJson } from '../store.ts'
import { boxInfo, helperVersion, lacks, type Probe, type Saved } from './install.ts'

export interface MachineRec {
  machine: string
  /** its worker's address on this machine, once it runs */
  url: string
  lastSeen: number
}

export type Events = {
  snapshot: []
  chat: [key: string, chat: Chat]
  terminal: [key: string, screen: TermScreen]
  alert: [alert: Alert]
  news: [machine: string, news: Overview]
}

export interface Link {
  rec: MachineRec
  saved: Saved
  snap?: Snapshot
  chats: Map<string, Chat>
  ws?: WebSocket
  watching: { chats: string[]; term: string | null }
  reachable: boolean
  down?: number
  /** what you sent while it was out of reach */
  waiting: Action[]
  /** its worker: started here, or one from before a restart taken back */
  worker?: Worker
  /** how it is going, in a few words: Ready, Putting the helper there…, Can't reach it: … */
  state: string
  /** what it lacks, from the last check */
  lacks: string[]
  probe?: Probe
  busy?: boolean
  /** what went wrong putting Chrome there for the shared browser */
  chrome?: string
  /** not reached yet since this server started: shown as connecting, not as out of reach, for a while */
  connecting: boolean
  health: WorkerHealth
  polling?: boolean
}

export interface Worker {
  pid: number
  kill(signal?: 'SIGTERM' | 'SIGKILL'): void
  exited: Promise<unknown>
}

/** what of a machine is kept across a restart: herdr's record of it, the last look, and the chats on screen */
export interface Kept {
  saved: Saved
  probe?: Probe
  chats?: Chat[]
}

/** a machine not reached within this long of the start is out of reach, no longer connecting */
export const CONNECTING_FOR = 60_000

/** the server's code: a worker running the same code is kept across a restart of the main server */
let code = ''
export function codeVersion(dir = join(import.meta.dir, '..', '..')) {
  if (code) return code
  const h = createHash('sha256')
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const f = join(d, n)
      if (statSync(f).isDirectory()) walk(f)
      else if (/\.(ts|json)$/.test(n)) h.update(relative(dir, f)).update(readFileSync(f))
    }
  }
  for (const d of ['server', 'shared', 'plugins', 'generated']) if (existsSync(join(dir, d))) walk(join(dir, d))
  for (const f of ['package.json', 'bun.lock', 'plugins.json']) if (existsSync(join(dir, f))) h.update(f).update(readFileSync(join(dir, f)))
  code = h.digest('hex').slice(0, 16)
  return code
}

/** a process's command line: /proc where there is one (no process is started on the loop for it), else ps */
function commandOf(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ')
  } catch {
    return Bun.spawnSync(['ps', '-o', 'command=', '-p', String(pid)]).stdout.toString()
  }
}

/** a worker from before this server started, still running: its process, if it is one of Lineclear's */
export function running(pid: number | undefined): Worker | undefined {
  if (!pid || pid === process.pid) return undefined
  try {
    process.kill(pid, 0)
  } catch {
    return undefined
  }
  const cmd = commandOf(pid)
  if (!cmd.includes('server/main.ts')) return undefined
  const exited = new Promise((done) => {
    const t = setInterval(() => {
      try {
        process.kill(pid, 0)
      } catch {
        clearInterval(t)
        done(undefined)
      }
    }, 2000)
  })
  return { pid, kill: (signal = 'SIGTERM') => process.kill(pid, signal), exited }
}

/** a machine's own folder of records on this machine */
export const machineHome = (label: string) => join(HOME, 'machines', dirOf(label))

/** the folder of a machine's own worker and its store: tasks.json, server.json, worker.log. Nothing in it is a copy
 *  of that machine's tasks kept by this server (machines/<label> holds only last.json) */
export const workerHome = (label: string) => join(HOME, 'workers', dirOf(label))

/** a machine's folder name under machines/ */
export const dirOf = (label: string) => label.replace(/[^\w.-]+/g, '_')

/** Older versions ran a machine's worker inside machines/<label>, so its tasks.json sat where a mirror would. The
 *  worker is stopped and everything but last.json moves to workers/<label>: no tasks.json is left under machines/. */
function moveOldStore(d: string) {
  const from = join(HOME, 'machines', d)
  const to = join(HOME, 'workers', d)
  const files = readdirSync(from).filter((f) => f !== 'last.json')
  if (!files.length) return
  running(readJson<{ pid?: number }>(join('machines', d, 'server.json'), {}).pid)?.kill()
  mkdirSync(to, { recursive: true })
  for (const f of files) {
    if (existsSync(join(to, f))) rmSync(join(from, f), { recursive: true, force: true })
    else renameSync(join(from, f), join(to, f))
  }
}

/** what every machine showed before this server started. A machine's tasks are read over the link, never kept here:
 *  the snapshot an earlier version wrote into last.json is removed. (machines/<label>/tasks.json is not a copy: it is
 *  the store of that machine's own worker, which runs from this folder) */
export function kept(): Kept[] {
  const dir = join(HOME, 'machines')
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((d) => {
    moveOldStore(d)
    const k = readJson<(Kept & { snap?: unknown }) | null>(join('machines', d, 'last.json'), null)
    if (k && 'snap' in k) {
      delete k.snap
      writeJson(join('machines', d, 'last.json'), k)
    }
    return k?.saved?.label ? [k] : []
  })
}

/** the machine as last looked at is ready for a worker: nothing missing, and the helper there is this one's */
export const fits = (p: Probe) => !lacks(p).length && p.helper === helperVersion(p.os, p.arch)

/** a worker started from one look runs the same as from the other */
export const sameBox = (m: Saved, a: Probe, b: Probe) => JSON.stringify(boxInfo(m, a)) === JSON.stringify(boxInfo(m, b))
