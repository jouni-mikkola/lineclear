import { cpus } from 'node:os'

/** the agents Settings picks a CLI, model and effort for */
export type Role = 'task' | 'coordinator' | 'reviewer' | 'backup'
export const ROLES: Role[] = ['task', 'coordinator', 'reviewer', 'backup']

/** a count or a threshold: any number from min to max (step 1: whole numbers), kept with its unit ("7 days", "80%");
 *  off: it may be off too ("off"), zero: 0 is off */
export interface Num {
  min: number
  max: number
  step?: number
  /** the unit after the number, plural and singular ("days", "day"); none: a bare number */
  unit?: string
  one?: string
  off?: boolean
  zero?: boolean
}

export type Row = {
  label: string
  key: string
  value: string
  options?: string[]
  text?: boolean
  multiline?: boolean
  fixed?: boolean
  hint?: string
  lineclear?: string
  group?: string
  num?: Num
}

/** a level defaults are set at: Everywhere, this machine, or one of its spaces */
export type LevelKind = 'all' | 'machine' | 'space'
/** the levels a section's defaults may be set at (all three when none): a machine's capacity has no space level;
 *  alerts are one for all */
export type Section = { name: string; about?: string; rows: Row[]; levels?: LevelKind[]; told?: boolean; prompt?: boolean }

/** when this machine's tasks may start, and when its coordinator hears that the machine struggles (health.ts) */
export interface MachineLimits {
  /** tasks at work at once */
  max: number | null
  /** new tasks wait while the 1-minute load is over this many times the cores, or this much memory is in use (%);
   *  none: not limited by load */
  startLoad: number | null
  startMemory: number | null
  /** the coordinator is told when the load stays over this many times the cores for 10 minutes, memory or a disk is
   *  fuller than this (%), or herdr stops answering; null: that one is off */
  alertLoad: number | null
  alertMemory: number | null
  alertDisk: number | null
  alertHerdr: boolean
}

export type Values = Record<string, string>
export type Level = 'all' | 'machine' | { space: string }

export const kindOfLevel = (l: Level): LevelKind => (typeof l === 'string' ? l : 'space')
export interface Stored {
  everywhere: Values
  machine: Values
  spaces: Record<string, Values>
}

/** tasks at once on a machine with this many cores, unless set: two stay for a full check and the server (docs/numbers.md) */
export const defaultMaxTasks = (cores = cpus().length) => Math.max(1, cores - 2)
