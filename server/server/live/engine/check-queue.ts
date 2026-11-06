// The check lines. A full check loads every core for minutes, so each repo on each machine has one line of them:
// `lineclear check` and the merge lane's check of one repo take turns on the machine the check runs on, first come
// first served, and neither two repos nor two machines ever wait for each other's line.
// A machine's limit is its check slots (<config>/check-slots/<machine>), shared by every line of that machine and every
// `lineclear slot` run on it: a head of a line runs once it holds a slot. A turn is a file in <config>/check-queue/<machine>@<repo> named by when it came; a
// turn whose process is gone is dropped, so a killed check never holds its line. A running head records whether its
// processes still use the CPU, so a head that is stuck (on a lock, say) is seen and named. No imports beyond node and check-runs.ts: the
// Lineclear CLI (src/waits.ts) uses this file too.
import { linkSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cpus, homedir, loadavg } from 'node:os'
import { join } from 'node:path'
import { folderName, machineOf } from '../../../../src/check-runs.ts'

export interface Turn {
  /** its file in the line's folder: the order of the line */
  file: string
  pid: number
  /** who waits: a task id, or the project for a check run by hand */
  who: string
  /** when it came, in ms */
  since: number
  /** its turn has come and it holds a slot: it runs, so no lane turn goes before it */
  run?: boolean
  /** a merge turn of the lane: it goes before the checks task agents run themselves */
  lane?: boolean
  /** the root process of the check once it runs, and its CPU in ticks when last seen to change and when that was */
  work?: number
  cpu?: number
  moved?: number
  /** when the CPU was last sampled, in ms */
  seen?: number
}

type Env = Record<string, string | undefined>

/** a head whose processes use under IDLE_SHARE of a core for this long, while a lane turn waits behind it, is stuck */
export const STUCK_MS = 10 * 60_000
const IDLE_SHARE = 0.01
const TICKS_PER_S = 100

const configDir = (env: Env) => env.LINECLEAR_CONFIG ?? join(homedir(), '.config', 'lineclear')
const queueRoot = (env: Env) => join(configDir(env), 'check-queue')

export { machineOf }

const slotsDir = (env: Env) => join(configDir(env), 'check-slots', machineOf(env))

/** the machine a line belongs to; a machine's name never holds an @, so the first one ends it */
export const machineOfLine = (line: string) => line.split('@')[0] ?? ''

/** the lines of a repo on every machine that has one, this machine's first */
export function linesOf(repo: string, env: Env = process.env): string[] {
  const mine = lineOf(repo, env)
  const tail = mine.slice(mine.indexOf('@'))
  let all: string[] = []
  try {
    all = readdirSync(queueRoot(env)).filter((n) => n.endsWith(tail))
  } catch {
    // no line yet
  }
  return [mine, ...all.filter((n) => n !== mine).sort()]
}

/** the name of a repo's line on a machine: the machine, then its real path, as a folder name */
export function lineOf(repo: string, env: Env = process.env): string {
  let real = repo
  try {
    real = realpathSync(repo)
  } catch {
    // a repo that is gone keeps its path
  }
  return `${machineOf(env)}@${folderName(real)}`
}

/** a repo's line on the machine a task's check runs on (this machine's when the task has none) */
export const lineOn = (repo: string, machine?: string, env: Env = process.env) => lineOf(repo, machine ? { ...env, LINECLEAR_MACHINE: machine } : env)

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** a file that never shows half written, and fails when it is there already */
function createWhole(file: string, data: string) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, data)
  try {
    linkSync(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }
}

/** the line now: the running check first, then the lane's merge turns, then the task-side checks; the turns of processes that are gone leave it */
export function checkLine(line: string, env: Env = process.env): Turn[] {
  const dir = join(queueRoot(env), line)
  let names: string[]
  try {
    // a name starting with a dot is a turn still being written
    names = readdirSync(dir)
      .filter((n) => n.endsWith('.json') && !n.startsWith('.'))
      .sort()
  } catch {
    return []
  }
  const turns: Turn[] = []
  for (const file of names) {
    try {
      const t = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Partial<Turn>
      if (typeof t.pid === 'number' && t.pid > 0 && alive(t.pid)) turns.push({ ...t, file, pid: t.pid, who: String(t.who ?? ''), since: Number(t.since) || 0 })
      else rmSync(join(dir, file), { force: true })
    } catch {
      // gone just now
    }
  }
  const rank = (t: Turn) => (t.work || t.run ? 0 : t.lane ? 1 : 2)
  return turns.sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file))
}

let count = 0

const writeTurn = (path: string, turn: object) => {
  const tmp = join(path, '..', `.${path.split('/').at(-1)}`)
  writeFileSync(tmp, JSON.stringify(turn))
  renameSync(tmp, path)
}

/** joins a repo's line; returns the turn's handle, to leave it with leaveLine */
export function joinLine(who: string, line: string, env: Env = process.env, now = Date.now(), lane = false): string {
  mkdirSync(join(queueRoot(env), line), { recursive: true })
  // ms, then pid and a count: two that come in the same ms keep an order, and no two share a name
  const file = `${String(now).padStart(15, '0')}-${String(process.pid).padStart(8, '0')}-${String(count++).padStart(6, '0')}.json`
  writeTurn(join(queueRoot(env), line, file), { pid: process.pid, who, since: now, ...(lane ? { lane } : {}) })
  return `${line}/${file}`
}

/** marks the turn as running, so a lane turn that joins later does not go before it */
export function startTurn(turn: string, env: Env = process.env) {
  const path = join(queueRoot(env), turn)
  try {
    writeTurn(path, { ...(JSON.parse(readFileSync(path, 'utf8')) as Turn), run: true })
  } catch {
    // the turn is gone
  }
}

/** a merge turn of the lane is in the repo's line, waiting or running: an agent's own check gives way to it */
export const laneInLine = (line: string, env: Env = process.env): boolean => checkLine(line, env).some((t) => t.lane)

export const leaveLine = (turn: string, env: Env = process.env) => rmSync(join(queueRoot(env), turn), { force: true })

/** how many checks are before this turn in its line: 0 is its turn */
export function ahead(turn: string, env: Env = process.env): number {
  const [line, file] = turn.split('/') as [string, string]
  return Math.max(
    checkLine(line, env).findIndex((t) => t.file === file),
    0,
  )
}

const positive = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)

/** A machine's load limit: its machine.json's load per core (1 if unset) times its cores. */
export function limitOf(machine: unknown, cores: number): number {
  const per = positive((machine as { loadPerCore?: unknown } | null)?.loadPerCore)
  return Math.round((per ?? 1) * cores * 100) / 100
}

/** The check slots of a machine: `checkSlots` when set, else one per 1 / slotsPerCore cores (slotsPerCore 0.5 if unset), at least 1. */
function slotsOf(machine: unknown, cores: number): number {
  const set = positive((machine as { checkSlots?: unknown } | null)?.checkSlots)
  if (set !== undefined) return Math.floor(set) || 1
  const per = positive((machine as { slotsPerCore?: unknown } | null)?.slotsPerCore)
  return Math.max(1, Math.floor((per ?? 0.5) * cores))
}

/** the machine's check slots and its load limit, from <config>/machine.json; LINECLEAR_CORES stands in for the core count (tests) */
export function machineLimits(env: Env = process.env): { slots: number; loadLimit: number } {
  let m: unknown = null
  try {
    m = JSON.parse(readFileSync(join(configDir(env), 'machine.json'), 'utf8'))
  } catch {
    // none set
  }
  const cores = positive(Number(env.LINECLEAR_CORES)) ?? cpus().length
  return { slots: slotsOf(m, cores), loadLimit: limitOf(m, cores) }
}

/** a merge turn of the lane is first in its line and has no slot yet: an agent's own run leaves the slot to it. One still behind a check of its line waits for that, not for a slot. */
function laneWaiting(env: Env): boolean {
  const mine = `${machineOf(env)}@`
  try {
    return readdirSync(queueRoot(env))
      .filter((l) => l.startsWith(mine))
      .some((l) => {
        const head = checkLine(l, env)[0]
        return head?.lane === true && !head.run
      })
  } catch {
    return false
  }
}

/** Takes one of N slot files, or returns undefined. A slot whose holder has died is taken over. */
function takeOne(n: number, taken: string[], env: Env): string | undefined {
  for (let i = 0; i < n; i++) {
    const file = join(slotsDir(env), `slot-${i}`)
    if (taken.includes(file)) continue
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        createWhole(file, String(process.pid))
        return file
      } catch {
        let holder = NaN
        try {
          holder = Number(readFileSync(file, 'utf8').trim())
        } catch {
          continue // released just now, try again
        }
        if (holder > 0 && alive(holder)) break
        rmSync(file, { force: true })
      }
    }
  }
  return undefined
}

const holdFile = (env: Env) => join(slotsDir(env), 'release-hold')

/** the live process whose release check holds this machine's slots: no other run starts while it lives, killed or done */
export function releaseHolder(env: Env = process.env): number | undefined {
  let pid = NaN
  try {
    pid = Number(readFileSync(holdFile(env), 'utf8').trim())
  } catch {
    return undefined
  }
  if (pid > 0 && alive(pid)) return pid
  rmSync(holdFile(env), { force: true })
  return undefined
}

/** holds new starts on this machine for the release check of this process; false while another release check holds them */
export function holdForRelease(env: Env = process.env): boolean {
  mkdirSync(slotsDir(env), { recursive: true })
  const holder = releaseHolder(env)
  if (holder !== undefined) return holder === process.pid
  try {
    createWhole(holdFile(env), String(process.pid))
    return true
  } catch {
    return false
  }
}

export const dropReleaseHold = (env: Env = process.env) => {
  if (releaseHolder(env) === process.pid) rmSync(holdFile(env), { force: true })
}

/** Slots held by a live process now. */
export function slotsHeld(env: Env): number {
  try {
    return readdirSync(slotsDir(env)).filter((f) => {
      if (!f.startsWith('slot-')) return false
      const pid = Number(readFileSync(join(slotsDir(env), f), 'utf8').trim())
      return pid > 0 && alive(pid)
    }).length
  } catch {
    return 0
  }
}

/**
 * Takes `cost` slots together or none, so two costly commands never each hold half. The machine's load counts too: with
 * something running, a command waits while the load average is above the limit. With `yieldToLane` it takes none while
 * a lane turn waits for one. The slot files are the holder's to remove.
 */
export function takeSlots(cost: number, env: Env = process.env, o: { yieldToLane?: boolean } = {}): string[] | undefined {
  const holder = releaseHolder(env)
  if (holder !== undefined && holder !== process.pid) return undefined
  if (o.yieldToLane && laneWaiting(env)) return undefined
  const { slots, loadLimit } = machineLimits(env)
  mkdirSync(slotsDir(env), { recursive: true })
  const lock = join(slotsDir(env), '.lock')
  try {
    mkdirSync(lock)
  } catch {
    // a lock older than a few seconds was left by a process that died inside it
    try {
      if (Date.now() - statSync(lock).mtimeMs > 10_000) rmSync(lock, { recursive: true, force: true })
    } catch {
      // released just now
    }
    return undefined
  }
  try {
    if (slotsHeld(env) > 0 && (loadavg()[0] ?? 0) > loadLimit) return undefined
    const got: string[] = []
    for (let i = 0; i < Math.min(cost, slots); i++) {
      const f = takeOne(slots, got, env)
      if (f === undefined) {
        for (const g of got) rmSync(g, { force: true })
        return undefined
      }
      got.push(f)
    }
    return got
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
}

/** every process: its parent and the CPU ticks it has used itself and through the children it waited for; empty where /proc is not there */
function procTable(): Map<number, { parent: number; ticks: number }> {
  const rows = new Map<number, { parent: number; ticks: number }>()
  try {
    for (const d of readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue
      try {
        const stat = readFileSync(`/proc/${d}/stat`, 'utf8')
        // after the command name, which may hold spaces: state, ppid, ..., utime (field 14), stime, cutime, cstime
        const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
        rows.set(Number(d), { parent: Number(f[1]), ticks: Number(f[11]) + Number(f[12]) + Number(f[13]) + Number(f[14]) })
      } catch {
        // ended just now
      }
    }
  } catch {
    // no /proc
  }
  return rows
}

/** the processes under `root`, itself first */
function tree(root: number, rows = procTable()): number[] {
  const out = [root]
  // a child may have a lower pid than its parent, so go on until nothing joins
  for (let grown = true; grown; ) {
    grown = false
    for (const [pid, r] of rows) {
      if (out.includes(pid) || !out.includes(r.parent)) continue
      out.push(pid)
      grown = true
    }
  }
  return out
}

/** the CPU ticks the process and everything under it have used, or undefined where /proc is not there */
function treeCpu(root: number): number | undefined {
  const rows = procTable()
  return rows.has(root) ? tree(root, rows).reduce((sum, p) => sum + (rows.get(p)?.ticks ?? 0), 0) : undefined
}

const cwdOf = (pid: number) => {
  try {
    return realpathSync(`/proc/${pid}/cwd`)
  } catch {
    return ''
  }
}

/**
 * The processes this one started that work in one of `dirs` (a git or a check of a head, with whatever they start), and
 * the CPU ticks they have used together: what a head's progress is read from.
 */
export function workIn(dirs: string[], root = process.pid): { pids: number[]; ticks: number } {
  const rows = procTable()
  const real = dirs.map((d) => {
    try {
      return realpathSync(d)
    } catch {
      return d
    }
  })
  const inside = (pid: number) => real.some((d) => cwdOf(pid) === d || cwdOf(pid).startsWith(`${d}/`))
  const pids = tree(root, rows).filter((p) => p !== root && inside(p))
  const all = [...new Set(pids.flatMap((p) => tree(p, rows)))]
  return { pids: all, ticks: all.reduce((sum, p) => sum + (rows.get(p)?.ticks ?? 0), 0) }
}

/** Ends what `workIn` finds in `dirs`: a released head's git or check, with whatever it started. */
export function killWork(dirs: string[]) {
  for (const pid of workIn(dirs).pids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // ended just now
    }
  }
}

const comm = (pid: number) => {
  try {
    return readFileSync(`/proc/${pid}/comm`, 'utf8').trim()
  } catch {
    return String(pid)
  }
}

/**
 * What a stuck check waits for, if the kernel says: a file lock one of its processes is blocked on (the file and who
 * holds it), else the process it ends in.
 */
function blockedOn(root: number): string {
  const pids = tree(root)
  try {
    const rows = readFileSync('/proc/locks', 'utf8').split('\n')
    for (const [i, row] of rows.entries()) {
      const f = row.trim().split(/\s+/)
      if (f[1] !== '->') continue
      const blocked = Number(f[5])
      if (!pids.includes(blocked)) continue
      const inode = Number(f[6]?.split(':')[2])
      // the lock it waits for is the row above with no arrow
      const held = rows
        .slice(0, i)
        .reverse()
        .find((r) => r.trim().split(/\s+/)[1] !== '->')
      const holder = Number(held?.trim().split(/\s+/)[4])
      let file = ''
      for (const fd of readdirSync(`/proc/${blocked}/fd`)) {
        try {
          const path = readlinkSync(`/proc/${blocked}/fd/${fd}`)
          if (statSync(path).ino === inode) file = path
        } catch {
          // not a file
        }
      }
      return `the lock ${file || `on inode ${inode}`}${holder ? ` held by ${comm(holder)} (pid ${holder})` : ''}`
    }
  } catch {
    // no /proc/locks
  }
  return `${comm(pids.at(-1) ?? root)} (pid ${pids.at(-1) ?? root}), which uses no CPU`
}

/** Records on the turn, every `ms`, whether the check's processes still use the CPU. Returns the way to point it at the check and to stop. */
export function watchProgress(turn: string, env: Env = process.env, ms = 30_000, now = Date.now): { track: (pid: number) => void; stop: () => void } {
  const path = join(queueRoot(env), turn)
  let pid = 0
  const sample = () => {
    const cpu = pid ? treeCpu(pid) : undefined
    if (cpu === undefined) return
    try {
      const t = JSON.parse(readFileSync(path, 'utf8')) as Turn
      const at = now()
      if (t.work !== pid || t.cpu === undefined || t.seen === undefined) return writeTurn(path, { ...t, work: pid, cpu, seen: at, moved: at })
      const busy = cpu - t.cpu >= IDLE_SHARE * TICKS_PER_S * ((at - t.seen) / 1000)
      writeTurn(path, { ...t, cpu, seen: at, moved: busy ? at : t.moved })
    } catch {
      // the turn is gone
    }
  }
  const timer = setInterval(sample, ms)
  timer.unref()
  return {
    track: (p) => {
      pid = p
      sample()
    },
    stop: () => clearInterval(timer),
  }
}

export interface StuckHead {
  who: string
  /** ms since its processes last used the CPU */
  idle: number
  /** what it waits for, if it can be told */
  reason: string
}

/** The running heads of the repo's line that show no progress for STUCK_MS while a lane turn waits behind them. */
export function stuckHeads(line: string, env: Env = process.env, now = Date.now()): StuckHead[] {
  const head = checkLine(line, env)[0]
  if (!head?.work || !head.moved || now - head.moved < STUCK_MS || !alive(head.work)) return []
  if (!checkLine(line, env).some((t) => t.lane && t.file !== head.file)) return []
  return [{ who: head.who, idle: now - head.moved, reason: blockedOn(head.work) }]
}

/** "the check line of box is stuck: LIN-1's check shows no progress for 31 min, it waits for ...", for status and Home */
export const stuckLine = (s: StuckHead, line: string) =>
  `the check line of ${machineOfLine(line)} is stuck: ${s.who}'s check shows no progress for ${Math.round(s.idle / 60_000)} min, it waits for ${s.reason}`

/** "the check line of box: LIN-1 runs, 2 wait", for status and Home; empty for a line with no check in it */
export function lineState(line: string, env: Env = process.env): string {
  const turns = checkLine(line, env)
  const runs = turns.filter((t) => t.work || t.run)
  const waiting = turns.length - runs.length
  if (turns.length === 0) return ''
  return `the check line of ${machineOfLine(line)}: ${runs.map((t) => `${t.who} runs`).join(', ') || 'no check runs'}${waiting ? `, ${waiting} wait` : ''}`
}

/**
 * Runs `run` in its turn: no check before it in its repo's line, and a check slot held on `slotMachine` (this machine when left out). `waiting` hears
 * how many checks are before it and whether it waits for a slot whenever that changes, and (0, 0) once its turn has
 * come. `dropped` gives the result to return instead when the run is no longer wanted. `run` points `track` at the check's process, so a stuck check shows. The turn and the slot end with `run`,
 * however it ends.
 */
export async function inTurn<T>(
  who: string,
  line: string,
  run: (track: (pid: number) => void) => Promise<T>,
  o: {
    env?: Env
    slotMachine?: string
    pollMs?: number
    watchMs?: number
    waiting?: (ahead: number, noSlot: number) => void
    dropped?: () => T | undefined
  } = {},
): Promise<T> {
  const turn = joinLine(who, line, o.env, Date.now(), true)
  // the line is the project's; the heavy slot is the machine the check runs on
  const slotEnv = o.slotMachine ? { ...(o.env ?? process.env), LINECLEAR_MACHINE: o.slotMachine } : o.env
  let slot: string[] | undefined
  const watch = watchProgress(turn, o.env, o.watchMs)
  try {
    let last = ''
    for (;;) {
      // its task is gone: the turn leaves the line at once, not when it comes up
      const dropped = o.dropped?.()
      if (dropped !== undefined) return dropped
      const n = ahead(turn, o.env)
      slot = n === 0 ? takeSlots(1, slotEnv) : undefined
      const h = n === 0 && !slot ? 1 : 0
      if (`${n} ${h}` !== last) o.waiting?.(n, h)
      last = `${n} ${h}`
      if (slot) {
        startTurn(turn, o.env)
        heldSlots.set(turn, slot)
        break
      }
      await Bun.sleep(o.pollMs ?? 1000)
    }
    return await run(watch.track)
  } finally {
    watch.stop()
    // a released turn's slot was given back already, and may be someone else's now
    for (const f of heldSlots.get(turn) ?? []) rmSync(f, { force: true })
    heldSlots.delete(turn)
    leaveLine(turn, o.env)
  }
}

/** the slot each running turn of this process holds, so a released turn gives it back */
const heldSlots = new Map<string, string[]>()

/** Ends this process's turn of `who` in the line at once, however far it is: its turn leaves the line and its check slot goes free. */
export function releaseTurn(line: string, who: string, env: Env = process.env) {
  for (const t of checkLine(line, env).filter((t) => t.who === who && t.pid === process.pid)) {
    for (const f of heldSlots.get(`${line}/${t.file}`) ?? []) rmSync(f, { force: true })
    heldSlots.delete(`${line}/${t.file}`)
    leaveLine(`${line}/${t.file}`, env)
  }
}
