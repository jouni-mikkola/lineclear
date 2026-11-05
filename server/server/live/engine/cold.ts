// Tasks that ended over COLD_AFTER ago leave tasks.json for tasks-cold.jsonl, an append log: a line per change of
// one of them (the last line of an id wins, `{"gone": id}` drops it). Finished agents' records do the same, from
// agents.json to agents-cold.jsonl. They stay in memory as before, but a change writes only the ones still at work
// whole, so each write stays small however many tasks the board has kept.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HOME, readJson, writeJson } from '../../store.ts'

export const COLD_AFTER = 86_400_000
export const COLD_FILE = 'tasks-cold.jsonl'
export const COLD_AGENTS = 'agents-cold.jsonl'

type Rec = Record<string, unknown>

/** The records of a log, by `idKey`, in the order they first went cold. */
function readCold(file: string, idKey = 'id'): Rec[] {
  const by = new Map<string, Rec>()
  if (!existsSync(file)) return []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    try {
      const r = JSON.parse(line) as Rec
      if (typeof r?.gone === 'string') by.delete(r.gone)
      else if (typeof r?.[idKey] === 'string') by.set(r[idKey] as string, r)
    } catch {
      // a line cut short by a stop mid-write: the one before it stands
    }
  }
  return [...by.values()]
}

/** a top-level copy: a cold task changes by assignment, so a changed field is a new value here */
const same = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

export class ColdLog<T extends object> {
  private file: string
  /** each cold record as last written */
  private written = new Map<string, Record<string, unknown>>()
  private lines = 0
  private id: (t: T) => string

  constructor(
    name = COLD_FILE,
    private idKey = 'id',
    dir = HOME,
  ) {
    this.file = join(dir, name)
    this.id = (t) => (t as Record<string, unknown>)[idKey] as string
  }

  /** The records of the whole file with the cold ones before them; one in both is the whole file's (a stop between
   *  writes). */
  load(hot: T[]): T[] {
    const ids = new Set(hot.map(this.id))
    const cold = readCold(this.file, this.idKey).filter((t) => !ids.has(t[this.idKey] as string)) as unknown as T[]
    for (const t of cold) this.written.set(this.id(t), { ...(t as Record<string, unknown>) })
    this.lines = existsSync(this.file) ? readFileSync(this.file, 'utf8').split('\n').filter(Boolean).length : 0
    return [...cold, ...hot]
  }

  /** Appends what changed among the cold records and returns the rest, for the whole file. */
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
      const kept = out(t)
      const now = kept as Record<string, unknown>
      if (was && same(was, now)) continue
      this.written.set(id, { ...now })
      lines.push(JSON.stringify(kept))
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
      appendFileSync(this.file, `${lines.join('\n')}\n`)
      this.lines += lines.length
    }
    return hot
  }

  private compact<T>(cold: T[]) {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, cold.map((t) => `${JSON.stringify(t)}\n`).join(''))
    renameSync(tmp, this.file)
    this.lines = cold.length
  }
}

/** tasks.json's data with the cold tasks of `cold` read back into its list */
export function withCold<T extends object, D extends { tasks: T[] }>(cold: ColdLog<T>, data: D): D {
  data.tasks = cold.load(data.tasks)
  return data
}

type AgentLine = { key: string; started: number; finished?: boolean }

/** agents.json by key, a record finished over COLD_AFTER after it started kept in agents-cold.jsonl */
export class ColdAgents<T extends AgentLine = AgentLine> {
  private cold = new ColdLog<T>(COLD_AGENTS, 'key')

  read(): Record<string, T> {
    return Object.fromEntries(this.cold.load(Object.values(readJson<Record<string, T>>('agents.json', {}))).map((r) => [r.key, r]))
  }

  /** only a change to a cold record is written, as one line */
  write(records: Record<string, T>, now = Date.now()) {
    const hot = this.cold.save(Object.values(records), (r) => !!r.finished && now - r.started >= COLD_AFTER)
    writeJson('agents.json', Object.fromEntries(hot.map((r) => [r.key, r])))
  }
}
