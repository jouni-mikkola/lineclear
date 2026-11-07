// The task list in store.sqlite: a row per task (its record without the brief, and whether it was retired), a row per
// brief and one for the counters. A save writes only the rows that changed, in one transaction, so a status line
// costs one small row however many tasks the board keeps. Retired rows stay for `lineclear measure` and Home.
import type { Database } from 'bun:sqlite'
import { db, tx } from '../../store.ts'
import { importLegacyTasks } from './task-import.ts'

export interface StoreData<T> {
  next: Record<string, number>
  tasks: T[]
  red?: Record<string, string>
}

type Row = { id: string; json: string; brief: string | null }

const SCHEMA = `
create table if not exists tasks (id text primary key, json text not null, retired integer not null default 0);
create table if not exists task_briefs (id text primary key, brief text not null);
create table if not exists task_meta (key text primary key, value text not null)`

export class TaskRows<T extends { id: string; desc?: string }> {
  /** task rows written since this was made */
  rowWrites = 0
  private json = new Map<string, string>()
  private brief = new Map<string, string | undefined>()
  private meta = ''

  /** Reads the live tasks; the old files are imported first, once. Throws when the store cannot be read. */
  load(): StoreData<T> {
    db.exec(SCHEMA)
    importLegacyTasks()
    const rows = db
      .query('select t.id, t.json, b.brief from tasks t left join task_briefs b on b.id = t.id where t.retired = 0 order by t.rowid')
      .all() as Row[]
    const tasks = rows.map((r) => {
      const t = JSON.parse(r.json) as T
      if (r.brief !== null) t.desc = r.brief
      this.json.set(r.id, r.json)
      this.brief.set(r.id, r.brief ?? undefined)
      return t
    })
    const m = db.query("select value from task_meta where key = 'meta'").get() as { value: string } | null
    this.meta = m?.value ?? ''
    const { next = {}, red } = m ? (JSON.parse(m.value) as { next?: Record<string, number>; red?: Record<string, string> }) : {}
    return { next, tasks, red }
  }

  /** Writes the rows that changed since the last save; `data.tasks` are the live ones. */
  save(data: StoreData<T>) {
    const changed: { id: string; json: string; desc: string | undefined }[] = []
    const seen = new Set<string>()
    for (const t of data.tasks) {
      seen.add(t.id)
      const { desc, ...rest } = t
      const json = JSON.stringify(rest)
      if (this.json.get(t.id) !== json || this.brief.get(t.id) !== desc) changed.push({ id: t.id, json, desc })
    }
    const gone = [...this.json.keys()].filter((id) => !seen.has(id))
    const meta = JSON.stringify({ next: data.next, red: data.red })
    if (!changed.length && !gone.length && meta === this.meta) return
    tx((s) => {
      for (const c of changed) this.put(s, c.id, c.json, c.desc, 0)
      for (const id of gone) {
        s.query('delete from tasks where id = ? and retired = 0').run(id)
        s.query('delete from task_briefs where id = ?').run(id)
      }
      if (meta !== this.meta) {
        s.query("insert into task_meta (key, value) values ('meta', ?) on conflict(key) do update set value = excluded.value").run(meta)
      }
    })
    for (const c of changed) {
      this.json.set(c.id, c.json)
      this.brief.set(c.id, c.desc)
    }
    for (const id of gone) {
      this.json.delete(id)
      this.brief.delete(id)
    }
    this.meta = meta
    this.rowWrites += changed.length
  }

  /** Marks these tasks retired, in one transaction: they leave the live list and stay as rows. */
  retire(tasks: T[]) {
    tx((s) => {
      for (const t of tasks) {
        const { desc, ...rest } = t
        this.put(s, t.id, JSON.stringify(rest), desc, 1)
      }
    })
    for (const t of tasks) {
      this.json.delete(t.id)
      this.brief.delete(t.id)
    }
    this.rowWrites += tasks.length
  }

  private put(s: Database, id: string, json: string, desc: string | undefined, retired: number) {
    s.query('insert into tasks (id, json, retired) values (?, ?, ?) on conflict(id) do update set json = excluded.json, retired = excluded.retired').run(
      id,
      json,
      retired,
    )
    if (desc === undefined) s.query('delete from task_briefs where id = ?').run(id)
    else s.query('insert into task_briefs (id, brief) values (?, ?) on conflict(id) do update set brief = excluded.brief').run(id, desc)
  }
}
