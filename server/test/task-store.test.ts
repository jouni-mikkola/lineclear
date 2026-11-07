// The task store loses nothing: a bad file stops the server, a cut write never breaks a reload, a save writes little.
import { describe, expect, test } from 'bun:test'
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { COLD_FILE, ColdLog } from '../server/live/engine/cold.ts'
import { Briefs } from '../server/live/engine/briefs.ts'
import { LOG_FILE, STORE_FILE, TaskStore, readStore } from '../server/live/engine/task-store.ts'

type T = { id: string; title: string; updated: number }
const dir = () => mkdtempSync(join(tmpdir(), 'task-store-'))
const task = (i: number, updated = 0): T => ({ id: `S-${i}`, title: `Task ${i} ${'x'.repeat(200)}`, updated })

describe('task store', () => {
  test('a truncated tasks.json stops the start, is kept as tasks.json.bad-<time> and is not replaced', () => {
    const d = dir()
    const first = new TaskStore<T>(d)
    first.load()
    first.save({ next: { S: 40 }, tasks: Array.from({ length: 40 }, (_, i) => task(i)) })
    // a snapshot, as a compaction writes it
    writeFileSync(join(d, STORE_FILE), JSON.stringify({ next: { S: 40 }, tasks: Array.from({ length: 40 }, (_, i) => task(i)) }))
    truncateSync(join(d, STORE_FILE), 1500)
    const before = readFileSync(join(d, STORE_FILE))
    expect(() => new TaskStore<T>(d).load()).toThrow(/tasks\.json\.bad-\d+/)
    expect(() => new TaskStore<T>(d).load()).toThrow()
    const bad = readdirSync(d).filter((f) => f.startsWith('tasks.json.bad-'))
    expect(bad).toHaveLength(1)
    expect(readFileSync(join(d, bad[0]))).toEqual(before)
    expect(readFileSync(join(d, STORE_FILE))).toEqual(before)
  })

  test('a store cut mid-save 1000 times always reloads, with the tasks of the last whole save', () => {
    const d = dir()
    const s = new TaskStore<T>(d)
    s.load()
    const copy = dir()
    let data = { next: { S: 0 }, tasks: [task(0), task(1), task(2)] }
    s.save(data)
    for (let i = 1; i <= 1000; i++) {
      const t = data.tasks.map((x, j) => (j === i % 3 ? { ...x, updated: i } : x))
      data = { next: { S: i }, tasks: t }
      s.save(data)
      // the stop falls inside what this save wrote: the log is cut at a random byte of its last line
      // on a copy, so the real store goes on whole
      const whole = readFileSync(join(d, LOG_FILE))
      rmSync(join(copy, STORE_FILE), { force: true })
      if (existsSync(join(d, STORE_FILE))) writeFileSync(join(copy, STORE_FILE), readFileSync(join(d, STORE_FILE)))
      writeFileSync(join(copy, LOG_FILE), whole.subarray(0, Math.max(whole.length - 1 - Math.floor(Math.random() * 120), 1)))
      const loaded = new TaskStore<T>(copy).load()
      expect(loaded.tasks).toHaveLength(3)
      for (const x of loaded.tasks) expect(x.title).toContain('Task')
      // at worst the cut save is missing: a task is never older than the save before it
      for (const x of loaded.tasks) expect(x.updated).toBeGreaterThanOrEqual(Math.max(0, i - 3))
    }
    expect(readStore<T>(d).data.tasks.map((x) => x.updated)).toEqual([999, 1000, 998])
  })

  test('a stop between the new snapshot and the new log leaves a log that is not replayed', () => {
    const d = dir()
    const s = new TaskStore<T>(d)
    s.load()
    s.save({ next: {}, tasks: [task(1, 1)] })
    const old = readFileSync(join(d, LOG_FILE), 'utf8')
    s.save({ next: {}, tasks: [task(1, 2)] })
    // the snapshot of gen 1 is out, the log is still the one of gen 0
    writeFileSync(join(d, STORE_FILE), JSON.stringify({ next: {}, tasks: [task(1, 9)], gen: 1 }))
    writeFileSync(join(d, LOG_FILE), old)
    expect(new TaskStore<T>(d).load().tasks[0].updated).toBe(9)
  })

  test('45 agents reporting for 10 minutes write 5 MB or less', () => {
    const d = dir()
    const s = new TaskStore<T>(d)
    s.load()
    // 561 tasks, 45 of them at work, about 1.2 KB each
    const tasks: T[] = Array.from({ length: 561 }, (_, i) => ({ ...task(i), title: 'y'.repeat(1100) }))
    s.save({ next: {}, tasks })
    const base = s.bytes
    // 200 saves a minute for 10 minutes, each one task reporting
    for (let i = 0; i < 2000; i++) {
      const k = i % 45
      tasks[k] = { ...tasks[k], updated: i + 1 }
      s.save({ next: {}, tasks })
    }
    expect(s.bytes - base).toBeLessThanOrEqual(5_000_000)
    expect(new TaskStore<T>(d).load().tasks).toHaveLength(561)
  })

  test('a cold log line that does not parse is skipped, kept in the .bad file and listed', () => {
    const d = dir()
    const log = new ColdLog<{ id: string; at: number }>(COLD_FILE, 'id', d)
    log.save([{ id: 'C-1', at: 1 }], () => true)
    appendFileSync(join(d, COLD_FILE), '{"id":"C-2","at')
    const again = new ColdLog<{ id: string; at: number }>(COLD_FILE, 'id', d)
    expect(again.load([]).map((t) => t.id)).toEqual(['C-1'])
    expect(again.skipped).toEqual(['{"id":"C-2","at'])
    expect(readFileSync(join(d, `${COLD_FILE}.bad`), 'utf8')).toContain('C-2')
    // the next line does not join onto the cut one
    again.save(
      [
        { id: 'C-1', at: 1 },
        { id: 'C-3', at: 1 },
      ],
      () => true,
    )
    expect(new ColdLog<{ id: string; at: number }>(COLD_FILE, 'id', d).load([]).map((t) => t.id)).toEqual(['C-1', 'C-3'])
  })

  test('a missing brief file is named and the task is listed as lost', () => {
    const briefs = new Briefs()
    const tasks = [{ id: 'B-1', briefPath: 'tasks/B-1/gone.md', desc: undefined as string | undefined }]
    briefs.read(tasks)
    expect([...briefs.lost.keys()]).toEqual(['B-1'])
  })
})
