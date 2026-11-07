// Ended tasks leave the live list after RETIRE_AFTER, so what the board reads and writes on every change stays small
// however long it runs. Their rows are marked retired in one transaction (where `lineclear measure` and Home read
// them), and their chat logs move to archive/chatlog/.
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { HOME } from '../../store.ts'

const RETIRE_AFTER = 90 * 86_400_000

export interface Retired {
  id: string
  updated: number
  doneAt?: number
  merged?: boolean
}

function moveChats(tasks: Retired[]) {
  const log = join(HOME, 'chatlog')
  if (!existsSync(log)) return
  const dir = join(HOME, 'archive', 'chatlog')
  mkdirSync(dir, { recursive: true })
  const ids = new Set(tasks.map((t) => t.id))
  for (const f of readdirSync(log)) {
    const id = f.match(/^([A-Za-z0-9]+-\d+)_/)?.[1]
    if (id && ids.has(id)) renameSync(join(log, f), join(dir, f))
  }
}

/** Retires the tasks of `tasks` that `may` lets go and that ended RETIRE_AFTER before `now`, out of the list in place.
 *  The ones that went. */
export function retireDue<T extends Retired>(rows: { retire(due: T[]): void }, tasks: T[], may: (t: T) => boolean, now = Date.now()): T[] {
  const due = tasks.filter((t) => may(t) && now - (t.doneAt ?? t.updated) >= RETIRE_AFTER)
  if (!due.length) return due
  rows.retire(due)
  moveChats(due)
  const gone = new Set(due.map((t) => t.id))
  tasks.splice(0, tasks.length, ...tasks.filter((t) => !gone.has(t.id)))
  return due
}
