// The tasks the older versions kept in files, turned into rows once (store.ts importOnce): tasks.json with its hot
// log (tasks-hot.jsonl), the ended tasks of tasks-cold.jsonl, each task's brief file, and the retired ones of
// archive/tasks-<month>.jsonl. Each log is renamed `*.imported` afterwards, like tasks.json.
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { HOME, importOnce } from '../../store.ts'

type Rec = {
  id?: unknown
  gone?: unknown
  meta?: { next?: Record<string, number>; red?: Record<string, string> }
  gen?: unknown
  desc?: string
  briefPath?: string
  briefSize?: number
} & Record<string, unknown>
type Legacy = { next?: Record<string, number>; red?: Record<string, string>; tasks?: Rec[]; gen?: number }

/** the lines of a log that parse; a line cut short by a stop mid-write is skipped */
function jsonLines(file: string): Rec[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((l) => {
      try {
        return l ? [JSON.parse(l) as Rec] : []
      } catch {
        return []
      }
    })
}

/** the records of an append log by id: the last line of an id wins and `{"gone": id}` drops it */
function replay(lines: Rec[], into: Map<string, Rec>, file: Legacy) {
  for (const r of lines) {
    if (typeof r.gone === 'string') into.delete(r.gone)
    else if (r.meta) {
      file.next = r.meta.next ?? {}
      file.red = r.meta.red
    } else if (typeof r.id === 'string') into.set(r.id, r)
  }
}

const archived = () => {
  const dir = join(HOME, 'archive')
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /^tasks-.*\.jsonl$/.test(f))
        .map((f) => join(dir, f))
    : []
}

export function importLegacyTasks() {
  const done = importOnce<Legacy>('tasks.json', (file, store) => {
    const hot = new Map<string, Rec>((file.tasks ?? []).flatMap((t) => (typeof t.id === 'string' ? [[t.id, t] as const] : [])))
    // the hot log belongs to this snapshot only when its first line names the snapshot's gen
    const [head, ...log] = jsonLines(join(HOME, 'tasks-hot.jsonl'))
    if (head && head.gen === (file.gen ?? 0)) replay(log, hot, file)
    const cold = new Map<string, Rec>()
    replay(jsonLines(join(HOME, 'tasks-cold.jsonl')), cold, {})
    const live = new Map([...[...cold].filter(([id]) => !hot.has(id)), ...hot])
    const put = store.query('insert or ignore into tasks (id, json, retired) values (?, ?, ?)')
    const putBrief = store.query('insert or ignore into task_briefs (id, brief) values (?, ?)')
    const add = (t: Rec, retired: number) => {
      const { desc, briefPath, briefSize: _size, ...rest } = t
      let brief = desc
      if (briefPath) {
        try {
          brief = readFileSync(join(HOME, briefPath), 'utf8')
        } catch {
          console.error(`${t.id}: its brief file ${join(HOME, briefPath)} is missing`)
          brief ??= ''
        }
      }
      put.run(t.id as string, JSON.stringify(rest), retired)
      if (brief !== undefined) putBrief.run(t.id as string, brief)
    }
    for (const t of live.values()) add(t, 0)
    for (const f of archived()) for (const t of jsonLines(f)) if (typeof t.id === 'string') add(t, 1)
    store
      .query("insert into task_meta (key, value) values ('meta', ?) on conflict(key) do update set value = excluded.value")
      .run(JSON.stringify({ next: file.next ?? {}, red: file.red }))
  })
  if (!done) return
  for (const f of [join(HOME, 'tasks-hot.jsonl'), join(HOME, 'tasks-cold.jsonl'), join(HOME, 'archive', 'counts.json'), ...archived()]) {
    if (existsSync(f)) renameSync(f, `${f}.imported`)
  }
}
