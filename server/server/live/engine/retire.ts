// Ended tasks leave tasks.json after RETIRE_AFTER, and their chat logs leave chatlog/, so the files read and written on
// every change stay small however long the board runs. Their records go to archive/tasks-<month>.jsonl, their chats
// to archive/chatlog/, and how many per space key to archive/counts.json, where `lineclear measure` and Home read them.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { HOME } from '../../store.ts'
import { durableWrite, keepBad } from './task-store.ts'

const RETIRE_AFTER = 90 * 86_400_000

const month = (ms: number) => new Date(ms).toISOString().slice(0, 7)

export interface Retired {
  id: string
  updated: number
  doneAt?: number
  merged?: boolean
}

type Counts = Record<string, { merged: number; closed: number }>

/** The counts file; one that does not parse is kept as counts.json.bad-<time> and counted again from nothing, never lost. */
function readCounts(file: string): Counts {
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Counts
  } catch {
    keepBad(file)
    return {}
  }
}

function retireTasks(tasks: Retired[]) {
  const dir = join(HOME, 'archive')
  mkdirSync(join(dir, 'chatlog'), { recursive: true })
  const counts = readCounts(join(dir, 'counts.json'))
  for (const t of tasks) {
    // written before the task leaves tasks.json: a stop in between keeps it twice, never loses it
    appendFileSync(join(dir, `tasks-${month(t.doneAt ?? t.updated)}.jsonl`), `${JSON.stringify(t)}\n`)
    const key = t.id.replace(/-\d+$/, '')
    counts[key] ??= { merged: 0, closed: 0 }
    const c = counts[key]
    if (t.merged) c.merged++
    else c.closed++
  }
  durableWrite(join(dir, 'counts.json'), JSON.stringify(counts, null, 2))
  const log = join(HOME, 'chatlog')
  if (!existsSync(log)) return
  const ids = new Set(tasks.map((t) => t.id))
  for (const f of readdirSync(log)) {
    const id = f.match(/^([A-Za-z0-9]+-\d+)_/)?.[1]
    if (id && ids.has(id)) renameSync(join(log, f), join(dir, 'chatlog', f))
  }
}

/** Retires the tasks of `tasks` that `may` lets go and that ended RETIRE_AFTER before `now`, out of the list in place.
 *  The ones that went. */
export function retireDue<T extends Retired>(tasks: T[], may: (t: T) => boolean, now = Date.now()): T[] {
  const due = tasks.filter((t) => may(t) && now - (t.doneAt ?? t.updated) >= RETIRE_AFTER)
  if (!due.length) return due
  retireTasks(due)
  const gone = new Set(due.map((t) => t.id))
  tasks.splice(0, tasks.length, ...tasks.filter((t) => !gone.has(t.id)))
  return due
}
