import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { COLD_AFTER, COLD_FILE, ColdLog, withCold } from '../server/live/engine/cold.ts'

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
