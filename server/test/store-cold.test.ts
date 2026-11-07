import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { world } from './engine-world.ts'
import { COLD_AFTER, COLD_FILE, ColdLog, withCold } from '../server/live/engine/cold.ts'
import { HOME, writeJson } from '../server/store.ts'
import { readStore } from '../server/live/engine/task-store.ts'

type T = { id: string; done?: boolean; at: number }

const now = Date.now()
const isCold = (t: T) => !!t.done && now - t.at >= COLD_AFTER

test('a task done over a day ago leaves the hot list for tasks-cold.jsonl and is still found by id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cold-'))
  const log = new ColdLog<T>(COLD_FILE, 'id', dir)
  const tasks: T[] = [
    { id: 'A-1', done: true, at: now - 2 * COLD_AFTER },
    { id: 'A-2', done: true, at: now - 1000 },
    { id: 'A-3', at: now - 5 * COLD_AFTER },
  ]
  const hot = log.save(tasks, isCold)
  expect(hot.map((t) => t.id)).toEqual(['A-2', 'A-3'])
  expect(readFileSync(join(dir, COLD_FILE), 'utf8')).toContain('"A-1"')

  const again = withCold(new ColdLog<T>(COLD_FILE, 'id', dir), { tasks: hot })
  expect(again.tasks.find((t) => t.id === 'A-1')).toBeTruthy()
  expect(again.tasks).toHaveLength(3)
})

test('a cold task at work again leaves the cold file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cold-'))
  const log = new ColdLog<T>(COLD_FILE, 'id', dir)
  const old: T = { id: 'B-1', done: true, at: now - 2 * COLD_AFTER }
  log.save([old], isCold)
  log.save([{ ...old, done: false }], isCold)
  expect(withCold(new ColdLog<T>(COLD_FILE, 'id', dir), { tasks: [] as T[] }).tasks).toEqual([])
})

test('the engine writes a task merged or closed over a day ago to tasks-cold.jsonl, not tasks.json, and task(id) finds it', () => {
  rmSync(join(HOME, COLD_FILE), { force: true })
  const base = { project: 'p:x', by: 't', created: now - 9 * COLD_AFTER, updated: now - 9 * COLD_AFTER }
  writeJson('tasks.json', {
    next: { CLD: 5 },
    tasks: [
      { ...base, id: 'CLD-1', n: 1, title: 'Old merged', merged: true, doneAt: now - 3 * COLD_AFTER },
      { ...base, id: 'CLD-2', n: 2, title: 'Old closed', closed: true, doneAt: now - 2 * COLD_AFTER },
      { ...base, id: 'CLD-3', n: 3, title: 'Fresh merged', merged: true, doneAt: now - 1000 },
      { ...base, id: 'CLD-4', n: 4, title: 'Open' },
    ],
  })
  const w = world()
  w.engine.pin('CLD-4', true)

  const hot = readStore<{ id: string }>(HOME).data.tasks.map((t) => t.id)
  expect(hot).toEqual(['CLD-3', 'CLD-4'])
  expect(existsSync(join(HOME, COLD_FILE))).toBe(true)
  const cold = readFileSync(join(HOME, COLD_FILE), 'utf8')
  expect(cold).toContain('"CLD-1"')
  expect(cold).toContain('"CLD-2"')
  expect(cold).not.toContain('"CLD-3"')

  const again = world()
  expect(again.engine.task('CLD-1')?.title).toBe('Old merged')
  expect(again.engine.task('cld-2')?.title).toBe('Old closed')
})
