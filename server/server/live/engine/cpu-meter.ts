// The CPU a task's process tree uses, by kind, one line per tick in cpu/<task>.jsonl under the data folder. Time is
// split into phases later, from the agent's session log (`lineclear measure phases`), so a line holds only a time,
// a kind and the ticks used since the last tick.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, realpathSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'

const CPU_KINDS = ['agent', 'bridge', 'tests', 'server', 'other'] as const
export type CpuKind = (typeof CPU_KINDS)[number]

export interface CpuRow {
  parent: number
  /** the CPU ticks it has used itself, not through children */
  ticks: number
  cwd: string
  cmd: string
}

/** what a process is, from its command line: a test or check run first, then the model bridge, the agent, a server */
function kindOf(cmd: string): CpuKind {
  if (/\b(bun (run )?(test|check|types|gates|ui:\w+)|tsc|biome|knip|playwright|vitest|jest|pytest)\b/.test(cmd)) return 'tests'
  if (/bridge/.test(cmd)) return 'bridge'
  if (/(^|[ /])(pi|claude)( |$)/.test(cmd)) return 'agent'
  if (/\b(serve|vite|http\.server|run --demo)\b/.test(cmd)) return 'server'
  return 'other'
}

/** every process under `root` (a /proc folder), with its own CPU ticks, parent, working folder and command line */
export function readProc(root = '/proc'): Map<number, CpuRow> {
  const rows = new Map<number, CpuRow>()
  try {
    for (const d of readdirSync(root)) {
      if (!/^\d+$/.test(d)) continue
      try {
        const stat = readFileSync(join(root, d, 'stat'), 'utf8')
        // after the command name, which may hold spaces: state, ppid, ..., utime (field 14), stime
        const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
        let cwd = ''
        try {
          cwd = readlinkSync(join(root, d, 'cwd'))
        } catch {
          // not ours to read
        }
        let cmd = ''
        try {
          cmd = readFileSync(join(root, d, 'cmdline'), 'utf8')
            .split('\0')
            .join(' ')
            .trim()
        } catch {
          // ended just now
        }
        rows.set(Number(d), { parent: Number(f[1]), ticks: Number(f[11]) + Number(f[12]), cwd, cmd })
      } catch {
        // ended just now
      }
    }
  } catch {
    // no /proc
  }
  return rows
}

/** The ticks used in total, by kind, by the processes working in `worktree` and everything they started. */
function ticksByKind(rows: Map<number, CpuRow>, worktree: string): Record<CpuKind, number> {
  const out: Record<CpuKind, number> = { agent: 0, bridge: 0, tests: 0, server: 0, other: 0 }
  const inside = (cwd: string) => cwd === worktree || cwd.startsWith(`${worktree}/`)
  const mine = new Set<number>()
  for (const [pid, r] of rows) if (inside(r.cwd)) mine.add(pid)
  // a child may have a lower pid than its parent, so go on until nothing joins
  for (let grown = true; grown; ) {
    grown = false
    for (const [pid, r] of rows) {
      if (mine.has(pid) || !mine.has(r.parent)) continue
      mine.add(pid)
      grown = true
    }
  }
  for (const pid of mine) {
    const r = rows.get(pid)
    if (r) out[kindOf(r.cmd)] += r.ticks
  }
  return out
}

export interface CpuEvent {
  at: number
  kind: CpuKind
  /** the ticks (1/100 s) used since the task's last tick */
  ticks: number
}

/** Keeps each task's last totals and writes what each tick added. A process that ended takes its ticks out of the total: that tick adds nothing. */
export class CpuMeter {
  private last = new Map<string, Record<CpuKind, number>>()

  constructor(private dir: string) {}

  sample(task: string, worktree: string, rows: Map<number, CpuRow>, now = Date.now()): CpuEvent[] {
    let real = worktree
    try {
      real = realpathSync(worktree)
    } catch {
      // the folder is gone: nothing runs in it
    }
    const total = ticksByKind(rows, real)
    const before = this.last.get(task)
    this.last.set(task, total)
    if (!before) return []
    const events = CPU_KINDS.flatMap((kind) => (total[kind] > before[kind] ? [{ at: now, kind, ticks: total[kind] - before[kind] }] : []))
    if (events.length) {
      mkdirSync(this.dir, { recursive: true })
      appendFileSync(join(this.dir, `${task}.jsonl`), events.map((e) => `${JSON.stringify(e)}\n`).join(''))
    }
    return events
  }

  forget(task: string) {
    this.last.delete(task)
  }
}
