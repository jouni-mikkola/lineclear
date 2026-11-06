// What the server reads of a machine: its load limit, and the processes working in a folder (a merge head's git, with
// whatever it started). The Lineclear CLI (src/waits.ts) uses this file too.
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { cpus, homedir } from 'node:os'
import { join } from 'node:path'

type Env = Record<string, string | undefined>

const configDir = (env: Env) => env.LINECLEAR_CONFIG ?? join(homedir(), '.config', 'lineclear')

const positive = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)

/** A machine's load limit: its machine.json's load per core (1 if unset) times its cores. */
export function limitOf(machine: unknown, cores: number): number {
  const per = positive((machine as { loadPerCore?: unknown } | null)?.loadPerCore)
  return Math.round((per ?? 1) * cores * 100) / 100
}

/** the machine's load limit, from <config>/machine.json; LINECLEAR_CORES stands in for the core count (tests) */
export function machineLimits(env: Env = process.env): { loadLimit: number } {
  let m: unknown = null
  try {
    m = JSON.parse(readFileSync(join(configDir(env), 'machine.json'), 'utf8'))
  } catch {
    // none set
  }
  const cores = positive(Number(env.LINECLEAR_CORES)) ?? cpus().length
  return { loadLimit: limitOf(m, cores) }
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
