import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRows, COLD_AGENTS } from '../server/live/engine/cold.ts'
import { SentLog } from '../server/live/agents-sent.ts'

type R = { key: string; started: number; logs: string[]; note?: string }

const records = () =>
  Object.fromEntries(
    Array.from({ length: 131 }, (_, i) => [`k${i}`, { key: `k${i}`, started: i, logs: ['/log/a'.repeat(100)], note: 'x'.repeat(2500) } satisfies R]),
  )

test('a save after one of 131 records changed writes under 8 KB', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rows-'))
  const rows = new AgentRows<R>(dir)
  const all = records()
  rows.write(all)
  const file = join(dir, COLD_AGENTS)
  const before = statSync(file).size
  expect(before).toBeGreaterThan(300_000)
  all.k7.logs.push('/log/b') // in place, as the agents do
  rows.write(all)
  expect(statSync(file).size - before).toBeLessThan(8192)
  expect(new AgentRows<R>(dir).read().k7.logs).toHaveLength(2)
  rows.write(all)
  expect(statSync(file).size - before).toBeLessThan(8192)
})

test('a deleted record stays gone and an older agents.json moves into the rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rows-'))
  writeFileSync(join(dir, 'agents.json'), JSON.stringify({ a: { key: 'a', started: 1, logs: [] }, b: { key: 'b', started: 2, logs: [] } }))
  const rows = new AgentRows<R>(dir)
  const read = rows.read()
  expect(Object.keys(read)).toEqual(['a', 'b'])
  delete read.a
  rows.write(read)
  expect(existsSync(join(dir, 'agents.json'))).toBe(false)
  expect(Object.keys(new AgentRows<R>(dir).read())).toEqual(['b'])
})

test('what went in is kept across a restart, with the news already delivered', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sent-'))
  const log = new SentLog(dir)
  const item = { id: 'i1', key: 'k', text: 't', at: Date.now(), cid: 'requested-news:1' }
  log.record(item)
  log.record({ ...item, id: 'i2', cid: 'c2' })
  const again = new SentLog(dir)
  expect(again.received('requested-news:1')).toBe(true)
  expect(again.received('c2')).toBe(false)
  expect(again.withId('c2')?.id).toBe('i2')
  expect(again.lately('k')).toHaveLength(2)
  expect(again.since('k', Date.now() + 1)).toEqual([])
  expect(readFileSync(join(dir, 'sent.jsonl'), 'utf8')).toContain('"receipt"')
})

test('receipts of the older file move into the log and the older files go', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sent-'))
  writeFileSync(join(dir, 'requested-news-receipts.json'), JSON.stringify(['requested-news:old']))
  writeFileSync(join(dir, 'typed.json'), '[]')
  expect(new SentLog(dir).received('requested-news:old')).toBe(true)
  expect(existsSync(join(dir, 'typed.json'))).toBe(false)
  expect(new SentLog(dir).received('requested-news:old')).toBe(true)
})
