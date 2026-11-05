// A task's brief sits in a file of its own, tasks/<id>/brief.md, written when it changes. tasks.json and the cold log
// keep only its path and size, so a change to any task rewrites a small file. The brief stays in memory as `desc`.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HOME } from '../../store.ts'

interface Briefed {
  id: string
  desc?: string
  briefPath?: string
  briefSize?: number
}

export class Briefs {
  /** each brief as last written to its file */
  private written = new Map<string, string>()

  /** `data` with each brief read back from its file */
  loaded<D extends { tasks: Briefed[] }>(data: D): D {
    this.read(data.tasks)
    return data
  }

  /** Reads the brief of each task that has a file back into `desc`; an older task still holds its own. */
  read(tasks: Briefed[]) {
    for (const t of tasks) {
      if (!t.briefPath) continue
      try {
        t.desc = readFileSync(join(HOME, t.briefPath), 'utf8')
        this.written.set(t.id, t.desc)
      } catch {
        // a lost file stays lost: no empty one is written over its place
        t.desc ??= ''
        this.written.set(t.id, t.desc)
      }
    }
  }

  /** Writes the briefs that changed and notes path and size on their tasks. */
  write(tasks: Briefed[]) {
    for (const t of tasks) {
      if (!t.desc && !t.briefPath) continue
      const text = t.desc ?? ''
      const path = `tasks/${t.id}/brief.md`
      if (this.written.get(t.id) !== text) {
        const file = join(HOME, path)
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
        writeFileSync(`${file}.tmp`, text)
        renameSync(`${file}.tmp`, file)
        this.written.set(t.id, text)
      }
      t.briefPath = path
      t.briefSize = Buffer.byteLength(text)
    }
  }
}

/** A task as the store keeps it: no brief when its file holds it. */
export function withoutBrief<T extends object>(t: T): T {
  const { desc, ...rest } = t as T & { desc?: string }
  return (rest as { briefPath?: string }).briefPath ? (rest as T) : t
}
