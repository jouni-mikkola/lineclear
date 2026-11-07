/** a machine's emoji as given: one emoji, its skin tone and joins kept; '' none; null anything else */
export function asEmoji(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim()
  if (!e) return ''
  const one = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(e)].length === 1
  return one && e.length <= 16 && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(e) ? e : null
}

/** A machine, as a heading over its spaces in the sidebar: no chat, nothing to open. How it is doing shows on it and in
 *  its home space. */
/** what Lineclear measures on a machine, as one level each: a share of what it has (CPU: its 1-minute load over its
 *  cores, so over 100 means more work than cores) */
export type HealthLevel = 'ok' | 'busy' | 'over'

export interface HealthMeter {
  /** CPU, Memory, Disk, GPU */
  name: string
  /** 0-100, or above for a CPU loaded past its cores */
  pct: number
  /** the numbers behind it, in a few words ("load 13.2 on 16 cores", "10 of 31 GB", "home 22% · /tmp 22%") */
  detail: string
  /** ok; busy: new tasks wait (start limit); over: past the alert limit, and the coordinator was told */
  level: HealthLevel
}

interface MachineHealth {
  /** CPU, Memory, Disk, and GPU where the machine has one */
  meters: HealthMeter[]
  /** herdr answers */
  herdr: boolean
  /** tasks at work now, and how many may be (none: no limit by number) */
  working: number
  max?: number
  /** tasks Lineclear holds until there is room, and why the first one waits */
  held: number
  heldWhy?: string
  /** when it was sampled ("08:41") */
  at: string
}

/** what a machine has room for: its 1-minute load, its cores, and its free and total memory in kB */
export interface Room {
  load: number
  cores: number
  freeKb: number
  totalKb: number
}

export interface Machine {
  /** m:<its key>: what its spaces' order and its fold are kept under */
  id: string
  /** its key: herdr's label for it */
  machine: string
  /** the name the human reads */
  name: string
  /** the emoji the human gave it, before its name as a Slack section's (none: a server icon) */
  emoji?: string
  /** off: Lineclear can't reach it */
  status: 'idle' | 'off'
  unreachableSince?: string
  connecting?: boolean
  /** how it is doing, sampled every 30 seconds */
  health?: MachineHealth
  herdrDown?: string
  /** its load, cores and memory, read by its own worker for its snapshot */
  room?: Room
  /** the tasks at work on it and the slots Settings give (none: no limit); the main machine's snapshot fills it for every machine */
  slots?: { working: number; max: number | null }
}
