import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Chat } from '../../shared/types.ts'
import { HOME, readJson, writeJson } from '../store.ts'
import type { Probe, Saved } from './install.ts'

/** what of a machine is kept across a restart: herdr's record of it, the last look, and the chats on screen */
export interface Kept {
  saved: Saved
  probe?: Probe
  chats?: Chat[]
}

/** Older versions ran a machine's worker inside machines/<label>, so its tasks.json sat where a mirror would. The
 *  worker is stopped and everything but last.json moves to workers/<label>: no tasks.json is left under machines/. */
function moveOldStore(d: string) {
  const from = join(HOME, 'machines', d)
  const to = join(HOME, 'workers', d)
  const files = readdirSync(from).filter((f) => f !== 'last.json' && f !== 'waiting.json')
  if (!files.length) return
  mkdirSync(to, { recursive: true })
  for (const f of files) {
    if (existsSync(join(to, f))) rmSync(join(from, f), { recursive: true, force: true })
    else renameSync(join(from, f), join(to, f))
  }
}

/** what every machine showed before this server started. A machine's tasks are read over the link, never kept here:
 *  the snapshot an earlier version wrote into last.json is removed, and a tasks.json left under machines/<label> moves
 *  to workers/<label> (see moveOldStore) */
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
