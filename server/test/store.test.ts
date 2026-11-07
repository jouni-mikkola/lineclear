import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { db, HOME, importOnce, openStore, StoreError, tx } from '../server/store.ts'

test('a store file that is not a database stops with its path', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'store-bad-')), 'store.sqlite')
  writeFileSync(file, 'this is not a database, it is long enough to look like a broken one'.repeat(100))
  expect(() => openStore(file)).toThrow(StoreError)
  expect(() => openStore(file)).toThrow(file)
})

test('the board refuses to start on a corrupt store and names the file', () => {
  const home = mkdtempSync(join(tmpdir(), 'store-board-'))
  const file = join(home, 'store.sqlite')
  writeFileSync(file, 'this is not a database, it is long enough to look like a broken one'.repeat(100))
  const run = Bun.spawnSync(['bun', join(import.meta.dir, '..', 'server', 'main.ts')], {
    env: { ...process.env, LINECLEAR_HOME: home, LINECLEAR_PORT: '0' },
    timeout: 20_000,
  })
  expect(run.exitCode).toBe(1)
  expect(run.stderr.toString()).toContain(file)
})

test('a good store opens in WAL mode with a busy timeout', () => {
  const store = openStore(join(mkdtempSync(join(tmpdir(), 'store-ok-')), 'store.sqlite'))
  expect((store.query('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal')
  expect((store.query('PRAGMA busy_timeout').get() as { timeout: number }).timeout).toBe(5000)
})

test('importOnce turns a JSON file into rows and renames it, even after a crash before the rename', () => {
  mkdirSync(HOME, { recursive: true })
  const file = join(HOME, 'store-test-old.json')
  writeFileSync(file, '{"a":1,"b":2}')
  db.exec('create table if not exists store_test_rows (k text primary key, v integer)')
  const load = (content: Record<string, number>, store: typeof db) => {
    for (const [k, v] of Object.entries(content)) store.query('insert into store_test_rows values (?, ?)').run(k, v)
  }
  expect(importOnce('store-test-old.json', load)).toBe(true)
  expect(existsSync(`${file}.imported`)).toBe(true)
  // the rename never happened: the file is back
  renameSync(`${file}.imported`, file)
  expect(importOnce('store-test-old.json', load)).toBe(true)
  expect((db.query('select count(*) n from store_test_rows').get() as { n: number }).n).toBe(2)
  expect(() =>
    tx((store) => {
      store.exec("insert into store_test_rows values ('c', 3)")
      throw new Error('no')
    }),
  ).toThrow('no')
  expect((db.query('select count(*) n from store_test_rows').get() as { n: number }).n).toBe(2)
})
