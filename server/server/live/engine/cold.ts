// An append log: a line per change of one record (the last line of an id wins, `{"gone": id}` drops it). Every agent record is a row of such a log
// (agents-cold.jsonl), so a change to one record writes that record only, however many the board has kept.
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HOME } from '../../store.ts'
import { durableWrite } from './durable.ts'

export const COLD_AGENTS = 'agents-cold.jsonl'

type Rec = Record<string, unknown>

/** The records of a log, by `idKey`, in the order they first went cold, and how many lines it has. A line that does not
 *  parse is kept in <file>.bad, where `lineclear doctor` finds it; the one before it stands. */
function readCold(file: string, idKey = 'id', repair = true): { recs: Rec[]; lines: number; skipped: string[] } {
  const by = new Map<string, Rec>()
  const skipped: string[] = []
  if (!existsSync(file)) return { recs: [], lines: 0, skipped }
  const text = readFileSync(file, 'utf8')
  let lines = 0
  for (const line of text.split('\n')) {
    if (!line) continue
    lines++
    try {
      const r = JSON.parse(line) as Rec
      if (typeof r?.gone === 'string') by.delete(r.gone)
      else if (typeof r?.[idKey] === 'string') by.set(r[idKey] as string, r)
      else skipped.push(line)
    } catch {
      skipped.push(line)
    }
  }
  if (repair && skipped.length) appendFileSync(`${file}.bad`, `${skipped.join('\n')}\n`)
  // a last line cut short has no end: the next line must not join onto it
  if (repair && text && !text.endsWith('\n')) appendFileSync(file, '\n')
  return { recs: [...by.values()], lines, skipped }
}

class ColdLog<T extends object> {
  private file: string
  /** each cold record as last written, as its line: a record changed in place still differs from it */
  private written = new Map<string, string>()
  private lines = 0
  /** lines of the log that did not parse when it was read */
  skipped: string[] = []
  private id: (t: T) => string

  constructor(
    name: string,
    private idKey = 'id',
    dir = HOME,
  ) {
    this.file = join(dir, name)
    this.id = (t) => (t as Record<string, unknown>)[idKey] as string
  }

  /** The records of the whole file with the cold ones before them; one in both is the whole file's (a stop between
   *  writes). */
  load(hot: T[], repair = true): T[] {
    const ids = new Set(hot.map(this.id))
    const read = readCold(this.file, this.idKey, repair)
    const cold = read.recs.filter((t) => !ids.has(t[this.idKey] as string)) as unknown as T[]
    for (const t of cold) this.written.set(this.id(t), JSON.stringify(t))
    this.lines = read.lines
    this.skipped = read.skipped
    return [...cold, ...hot]
  }

  /** Appends what changed among the records `isCold` picks and returns the rest, for the whole file. */
  save(tasks: T[], isCold: (t: T) => boolean, out: (t: T) => T = (t) => t): T[] {
    const hot: T[] = []
    const lines: string[] = []
    const seen = new Set<string>()
    for (const t of tasks) {
      if (!isCold(t)) {
        hot.push(t)
        continue
      }
      const id = this.id(t)
      seen.add(id)
      const was = this.written.get(id)
      const line = JSON.stringify(out(t))
      if (was === line) continue
      this.written.set(id, line)
      lines.push(line)
    }
    // deleted, retired, or at work again: its cold line must not bring it back
    for (const id of this.written.keys()) {
      if (seen.has(id)) continue
      this.written.delete(id)
      lines.push(JSON.stringify({ gone: id }))
    }
    if (!lines.length) return hot
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    // a log many times its tasks is written again whole, from memory
    if (this.lines + lines.length > 2 * this.written.size + 1000) this.compact(tasks.filter((t) => this.written.has(this.id(t))).map(out))
    else {
      const fd = openSync(this.file, 'a')
      try {
        writeSync(fd, `${lines.join('\n')}\n`)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      this.lines += lines.length
    }
    return hot
  }

  private compact<T>(cold: T[]) {
    durableWrite(this.file, cold.map((t) => `${JSON.stringify(t)}\n`).join(''))
    this.lines = cold.length
  }
}

type AgentLine = { key: string; started: number }

const byKey = <T extends AgentLine>(rows: T[]) => Object.fromEntries(rows.map((r) => [r.key, r]))

/** the rows of an older agents.json */
function olderAgents<T extends AgentLine>(file: string): T[] {
  try {
    return Object.values(JSON.parse(readFileSync(file, 'utf8')) as Record<string, T>)
  } catch {
    return [] // no older file, or one cut short: the rows stand
  }
}

/** the agent records of a folder by key: the rows of agents-cold.jsonl and those of an older agents.json */
export function readAgentRows<T extends AgentLine>(dir = HOME): Record<string, T> {
  // a folder that is not this process's own is only read: its log is not repaired here
  return byKey(new ColdLog<T>(COLD_AGENTS, 'key', dir).load(olderAgents<T>(join(dir, 'agents.json')), false))
}

/** agent records as rows: a save appends a line for each record that changed and none for the rest */
export class AgentRows<T extends AgentLine = AgentLine> {
  private rows: ColdLog<T>
  private older: string
  private olderGone = false

  constructor(dir = HOME) {
    this.rows = new ColdLog<T>(COLD_AGENTS, 'key', dir)
    this.older = join(dir, 'agents.json')
  }

  read(): Record<string, T> {
    return byKey(this.rows.load(olderAgents<T>(this.older)))
  }

  write(records: Record<string, T>) {
    this.rows.save(Object.values(records), () => true)
    // rows from an older agents.json are in the log now; left, it would win over later rows at the next start
    if (this.olderGone) return
    rmSync(this.older, { force: true })
    this.olderGone = true
  }
}
