import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { db, HOME, importOnce, openStore, StoreError, tx } from '../server/store.ts'

test('a store file that is not a database stops with its path', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'store-bad-')), 'store.sqlite')
  writeFileSync(file, 'this is not a database, it is long enough to look like a broken one'.repeat(100))
  expect(() => openStore(file)).toThrow(StoreError)
  expect(() => openStore(file)).toThrow(file)
})

test('a good store opens in WAL mode with a busy timeout', () => {
  const store = openStore(join(mkdtempSync(join(tmpdir(), 'store-ok-')), 'store.sqlite'))
  expect((store.query('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal')
  expect((store.query('PRAGMA busy_timeout').get() as { timeout: number }).timeout).toBe(5000)
})

test('importOnce turns a JSON file into rows and renames it; a failed transaction leaves nothing', () => {
  mkdirSync(HOME, { recursive: true })
  writeFileSync(join(HOME, 'old.json'), '{"a":1,"b":2}')
  db.exec('create table if not exists t (k text primary key, v integer)')
  const imported = importOnce<Record<string, number>>('old.json', (content, store) => {
    for (const [k, v] of Object.entries(content)) store.query('insert into t values (?, ?)').run(k, v)
  })
  expect(imported).toBe(true)
  expect(existsSync(join(HOME, 'old.json.imported'))).toBe(true)
  expect(importOnce('old.json', () => {})).toBe(false)
  expect(() =>
    tx((store) => {
      store.exec("insert into t values ('c', 3)")
      throw new Error('no')
    }),
  ).toThrow('no')
  expect((db.query('select count(*) n from t').get() as { n: number }).n).toBe(2)
})
