// The agents' state in store.sqlite: a row per agent record, a row per message waiting in the outbox and a row per
// message or receipt that went in (`typed`). A change writes the rows that changed, so a message to an agent costs
// one small row however many records the board keeps. The older files are imported once and renamed `*.imported`.
// The tables have an integer key and no index: a row with a text key and a few hundred bytes of json would cost
// an index page and an overflow page on every write.
import type { Database } from 'bun:sqlite'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { db, HOME, openStore, tx } from '../store.ts'

const SCHEMA = `
create table if not exists agents (n integer primary key, id text not null, json text not null);
create table if not exists outbox (n integer primary key, id text not null, json text not null);
create table if not exists typed (seq integer primary key, kind text not null, json text not null);
create table if not exists imports (name text primary key)`

const others = new Map<string, Database>()

/** the store of a folder: this process's own, or another installation's (a worker's home) opened as it is */
export function storeOf(dir: string): Database {
  const h = dir === HOME ? db : (others.get(dir) ?? openStore(join(dir, 'store.sqlite')))
  if (dir !== HOME) others.set(dir, h)
  h.exec(SCHEMA)
  return h
}

export const inTx = (h: Database, run: (s: Database) => void) => (h === db ? tx(run) : h.transaction(() => run(h)).immediate())

export const parse = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined // no file, or one cut short: what is in the rows stands
  }
}

export const lines = (file: string): unknown[] =>
  !existsSync(file)
    ? []
    : readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((l) => {
          try {
            return l ? [JSON.parse(l)] : []
          } catch {
            return [] // a line cut short by a stop mid-write
          }
        })

/** Imports the files of an older version once, in one transaction with the mark; the files go aside afterwards. */
export function importOlder(h: Database, name: string, files: string[], load: (store: Database) => void) {
  const done = h.query('select 1 from imports where name = ?').get(name)
  if (!done && files.some(existsSync)) {
    h.transaction(() => {
      load(h)
      h.query('insert into imports (name) values (?)').run(name)
    }).immediate()
  }
  // also after a stop between the import and the renames
  for (const f of files) if (existsSync(f) && (done || h.query('select 1 from imports where name = ?').get(name))) renameSync(f, `${f}.imported`)
}

type Row = { id: string; json: string }

/** An ordered list of rows of one table. A save writes the rows that changed, drops the ones gone and appends new ones;
 *  when a new row sits before an old one (or the old ones changed order), the rows from there on are written again. */
class RowList {
  private written = new Map<string, { n: number; json: string }>()
  private next = 1

  constructor(
    private h: Database,
    private table: 'agents' | 'outbox',
  ) {}

  load(): Row[] {
    const rows = this.h.query(`select n, id, json from ${this.table} order by n`).all() as { n: number; id: string; json: string }[]
    this.written = new Map(rows.map((r) => [r.id, { n: r.n, json: r.json }]))
    this.next = (rows.at(-1)?.n ?? 0) + 1
    return rows
  }

  save(rows: Row[]) {
    const now = new Set(rows.map((r) => r.id))
    const gone = [...this.written].filter(([id]) => !now.has(id))
    const kept = [...this.written].filter(([id]) => now.has(id)).sort((a, b) => a[1].n - b[1].n)
    // the first row that is not where the written ones say it is: from there on the rows are put in again
    let k = rows.length
    let seen = 0
    for (let i = 0; i < rows.length; i++) {
      const was = this.written.get(rows[i].id)
      if (!was && !rows.slice(i + 1).some((r) => this.written.has(r.id))) continue
      if (!was || kept[seen]?.[0] !== rows[i].id) {
        k = i
        break
      }
      seen++
    }
    const put: { id: string; json: string; reinsert: boolean }[] = []
    rows.forEach((r, i) => {
      const was = this.written.get(r.id)
      if (!was || i >= k) put.push({ ...r, reinsert: i >= k || !was })
      else if (was.json !== r.json) put.push({ ...r, reinsert: false })
    })
    if (!put.length && !gone.length) return
    const next = new Map<string, { n: number; json: string }>()
    let n = this.next
    inTx(this.h, (s) => {
      for (const [, w] of gone) s.query(`delete from ${this.table} where n = ?`).run(w.n)
      for (const p of put) {
        const was = this.written.get(p.id)
        if (!p.reinsert && was) {
          s.query(`update ${this.table} set json = ? where n = ?`).run(p.json, was.n)
          next.set(p.id, { n: was.n, json: p.json })
          continue
        }
        if (was) s.query(`delete from ${this.table} where n = ?`).run(was.n)
        s.query(`insert into ${this.table} (n, id, json) values (?, ?, ?)`).run(n, p.id, p.json)
        next.set(p.id, { n: n++, json: p.json })
      }
    })
    for (const [id] of gone) this.written.delete(id)
    for (const [id, v] of next) this.written.set(id, v)
    this.next = n
  }
}

type AgentLine = { key: string; started: number }

/** agent records as rows: a save writes the records that changed and drops the ones that are gone */
export class AgentRows<T extends AgentLine = AgentLine> {
  private list: RowList

  constructor(private dir = HOME) {
    this.list = new RowList(storeOf(dir), 'agents')
  }

  read(): Record<string, T> {
    const { dir } = this
    importOlder(storeOf(dir), 'agents.json', [join(dir, 'agents.json'), join(dir, 'agents-cold.jsonl')], (s) => {
      const rows = new Map<string, unknown>()
      for (const r of lines(join(dir, 'agents-cold.jsonl')) as { key?: string; gone?: string }[]) {
        if (typeof r.gone === 'string') rows.delete(r.gone)
        else if (typeof r.key === 'string') rows.set(r.key, r)
      }
      // agents.json is the newer of the two
      const hot = parse(join(dir, 'agents.json'))
      if (hot && typeof hot === 'object') for (const [k, r] of Object.entries(hot)) rows.set(k, r)
      let n = 1
      for (const [k, r] of rows) s.query('insert into agents (n, id, json) values (?, ?, ?)').run(n++, k, JSON.stringify(r))
    })
    return Object.fromEntries(this.list.load().map((r) => [r.id, JSON.parse(r.json) as T]))
  }

  write(records: Record<string, T>) {
    this.list.save(Object.entries(records).map(([id, r]) => ({ id, json: JSON.stringify(r) })))
  }
}

/** the agent records of a folder by key, read only (a worker's home is not this process's own) */
export function readAgentRows<T extends AgentLine>(dir: string): Record<string, T> {
  if (dir !== HOME && !existsSync(join(dir, 'store.sqlite'))) {
    const old = parse(join(dir, 'agents.json'))
    return (old && typeof old === 'object' ? old : {}) as Record<string, T>
  }
  return new AgentRows<T>(dir).read()
}

/** the messages waiting for their agents, in order: a save writes the rows that changed */
export class OutboxRows<T extends { id: string }> {
  private list: RowList

  constructor(private dir = HOME) {
    this.list = new RowList(storeOf(dir), 'outbox')
  }

  read(): T[] {
    const file = join(this.dir, 'outbox.json')
    importOlder(storeOf(this.dir), 'outbox.json', [file], (s) => {
      const old = parse(file)
      let n = 1
      if (Array.isArray(old)) for (const o of old as T[]) s.query('insert into outbox (n, id, json) values (?, ?, ?)').run(n++, o.id, JSON.stringify(o))
    })
    return this.list.load().map((r) => JSON.parse(r.json) as T)
  }

  write(items: T[]) {
    this.list.save(items.map((o) => ({ id: o.id, json: JSON.stringify(o) })))
  }
}
