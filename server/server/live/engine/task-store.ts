// The task list on disk: tasks.json is a snapshot, tasks-hot.jsonl the lines written since (a changed task whole, a
// `{"gone": id}`, a `{"meta": {next, red}}`). A save appends only what changed; the snapshot is written again, with
// the next `gen`, only when the log has grown past COMPACT_BYTES. The log's first line names the `gen` it belongs to,
// so a stop between the snapshot and the new log leaves a log that is ignored, never one that is replayed over a newer
// snapshot. A file that does not parse is never replaced by an empty list: the server refuses to start instead.
import { appendFileSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HOME } from '../../store.ts'

export const STORE_FILE = 'tasks.json'
export const LOG_FILE = 'tasks-hot.jsonl'
const COMPACT_BYTES = 4_000_000

export interface StoreData<T> {
  next: Record<string, number>
  tasks: T[]
  red?: Record<string, string>
  gen?: number
}

type Line = { id?: unknown; gone?: unknown; meta?: { next?: Record<string, number>; red?: Record<string, string> }; gen?: unknown }

/** write, flush, rename, flush the folder: after a power cut the file is the old one or the new one, never a hollow one */
export function durableWrite(file: string, text: string, mode = 0o644) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp`
  const fd = openSync(tmp, 'w', mode)
  try {
    writeSync(fd, text)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, file)
  const dir = openSync(dirname(file), 'r')
  try {
    fsyncSync(dir)
  } finally {
    closeSync(dir)
  }
}

/** Keeps a copy of a file that does not parse, as <file>.bad-<time>; one already kept with the same bytes is reused. */
export function keepBad(file: string): string {
  const text = readFileSync(file)
  const dir = dirname(file)
  const base = `${file.slice(dir.length + 1)}.bad-`
  for (const f of readdirSync(dir)) {
    if (f.startsWith(base) && readFileSync(join(dir, f)).equals(text)) return join(dir, f)
  }
  const bad = `${file}.bad-${Date.now()}`
  copyFileSync(file, bad)
  return bad
}

export interface Stored<T> {
  data: StoreData<T>
  /** log lines that did not parse */
  skipped: string[]
  /** the log needs writing whole again before it is appended to (a cut last line, a stale or bad log) */
  mend: boolean
  logBytes: number
}

/** The list as stored: the snapshot with the log replayed over it. Throws on a snapshot that does not parse. */
export function readStore<T extends { id: string }>(dir = HOME): Stored<T> {
  const file = join(dir, STORE_FILE)
  let data: StoreData<T> = { next: {}, tasks: [] }
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, 'utf8')) as StoreData<T>
      if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) throw new Error('no task list')
    } catch {
      const bad = keepBad(file)
      throw new Error(`${file} does not parse. Kept as ${bad}; nothing was started, so no empty list can replace it. Repair or restore it, then start again.`)
    }
  }
  const out: Stored<T> = { data, skipped: [], mend: false, logBytes: 0 }
  const logFile = join(dir, LOG_FILE)
  if (!existsSync(logFile)) return out
  const text = readFileSync(logFile, 'utf8')
  const lines = text.split('\n')
  const head = lines.shift() ?? ''
  let gen: unknown
  try {
    gen = (JSON.parse(head) as Line).gen
  } catch {
    // a head that does not parse belongs to no snapshot
  }
  if (gen !== (data.gen ?? 0)) {
    out.mend = text.length > 0
    return out
  }
  const by = new Map(data.tasks.map((t) => [t.id, t]))
  for (const line of lines) {
    if (!line) continue
    try {
      const r = JSON.parse(line) as Line
      if (typeof r.gone === 'string') by.delete(r.gone)
      else if (r.meta) {
        data.next = r.meta.next ?? {}
        data.red = r.meta.red
      } else if (typeof r.id === 'string') by.set(r.id, r as unknown as T)
      else out.skipped.push(line)
    } catch {
      out.skipped.push(line)
    }
  }
  data.tasks = [...by.values()]
  out.logBytes = Buffer.byteLength(text)
  out.mend = out.skipped.length > 0 || !text.endsWith('\n')
  return out
}

export class TaskStore<T extends { id: string }> {
  /** bytes written to the store since it was made */
  bytes = 0
  /** log lines that did not parse when it was read */
  skipped: string[] = []
  private gen = 0
  private logBytes = 0
  private last = new Map<string, string>()
  private meta = ''

  constructor(private dir = HOME) {}

  private get logFile() {
    return join(this.dir, LOG_FILE)
  }

  /** Reads the list. Throws when tasks.json does not parse. */
  load(): StoreData<T> {
    const s = readStore<T>(this.dir)
    this.gen = s.data.gen ?? 0
    this.skipped = s.skipped
    if (s.skipped.length) appendFileSync(`${this.logFile}.bad`, `${s.skipped.join('\n')}\n`)
    this.logBytes = s.logBytes
    this.remember(s.data)
    // a log cut short or stale is written whole again, so the next line does not join onto the cut one
    if (s.mend) this.compact(s.data)
    return s.data
  }

  private remember(data: StoreData<T>) {
    this.last = new Map(data.tasks.map((t) => [t.id, JSON.stringify(t)]))
    this.meta = JSON.stringify({ next: data.next, red: data.red })
  }

  /** Appends what changed since the last save; `data.tasks` are the ones that belong in the store. */
  save(data: StoreData<T>) {
    const lines: string[] = []
    const seen = new Set<string>()
    for (const t of data.tasks) {
      seen.add(t.id)
      const s = JSON.stringify(t)
      if (this.last.get(t.id) === s) continue
      this.last.set(t.id, s)
      lines.push(s)
    }
    for (const id of [...this.last.keys()]) {
      if (seen.has(id)) continue
      this.last.delete(id)
      lines.push(JSON.stringify({ gone: id }))
    }
    const meta = JSON.stringify({ next: data.next, red: data.red })
    if (meta !== this.meta) {
      this.meta = meta
      lines.push(`{"meta":${meta}}`)
    }
    if (!lines.length) return
    // a log past its size, or a change to most tasks (a migration): the snapshot is the cheaper way to say it
    if (this.logBytes > COMPACT_BYTES || lines.length > Math.max(20, data.tasks.length / 2)) return this.compact(data)
    const body = `${lines.join('\n')}\n`
    if (this.logBytes === 0) {
      const head = `${JSON.stringify({ gen: this.gen })}\n`
      this.writeLog(head + body)
      return
    }
    const fd = openSync(this.logFile, 'a')
    try {
      writeSync(fd, body)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    this.logBytes += Buffer.byteLength(body)
    this.bytes += Buffer.byteLength(body)
  }

  private writeLog(text: string) {
    durableWrite(this.logFile, text)
    this.logBytes = Buffer.byteLength(text)
    this.bytes += this.logBytes
  }

  private compact(data: StoreData<T>) {
    this.gen++
    const snapshot = JSON.stringify({ ...data, gen: this.gen })
    durableWrite(join(this.dir, STORE_FILE), snapshot)
    this.bytes += Buffer.byteLength(snapshot)
    this.writeLog(`${JSON.stringify({ gen: this.gen })}\n`)
    this.remember(data)
  }
}
