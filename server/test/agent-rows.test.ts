import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRows, OutboxRows, storeOf } from '../server/live/agent-rows.ts'
import { SentLog } from '../server/live/agents-sent.ts'

type R = { key: string; started: number; logs: string[]; note?: string }
type O = { id: string; key: string; text: string; at: number; cid?: string }

const records = () =>
  Object.fromEntries(
    Array.from({ length: 131 }, (_, i) => [`k${i}`, { key: `k${i}`, started: i, logs: ['/log/a'.repeat(100)], note: 'x'.repeat(2500) } satisfies R]),
  )

const dirOf = (name: string) => mkdtempSync(join(tmpdir(), `${name}-`))

test('delivering 100 messages to 131 agents writes under 300 KB', () => {
  const dir = dirOf('rows')
  const rows = new AgentRows<R>(dir)
  const outbox = new OutboxRows<O>(dir)
  const sent = new SentLog(dir)
  const all = records()
  rows.write(all)
  storeOf(dir).exec('PRAGMA wal_checkpoint(TRUNCATE)')
  for (let i = 0; i < 100; i++) {
    const item = { id: `m${i}`, key: `k${i % 131}`, text: `message ${i} ${'t'.repeat(200)}`, at: Date.now(), cid: `c${i}` }
    // one in ten waits in the outbox first, the rest go in at once
    if (i % 10 === 0) outbox.write([item])
    sent.record(item)
    if (i % 10 === 0) outbox.write([])
    rows.write(all)
  }
  const wal = statSync(join(dir, 'store.sqlite-wal')).size
  console.log(`100 messages delivered: ${wal} bytes in the WAL`)
  expect(wal).toBeLessThan(300_000)
  expect(Object.keys(new AgentRows<R>(dir).read())).toHaveLength(131)
})

test('a record that is gone stays gone and an older agents.json moves into the rows', () => {
  const dir = dirOf('rows')
  writeFileSync(join(dir, 'agents.json'), JSON.stringify({ a: { key: 'a', started: 1, logs: [] }, b: { key: 'b', started: 2, logs: [] } }))
  const rows = new AgentRows<R>(dir)
  const read = rows.read()
  expect(Object.keys(read)).toEqual(['a', 'b'])
  expect(existsSync(join(dir, 'agents.json'))).toBe(false)
  delete read.a
  rows.write(read)
  expect(Object.keys(new AgentRows<R>(dir).read())).toEqual(['b'])
})

test('the outbox keeps its order, also for an item put in front, and an older outbox.json moves in', () => {
  const dir = dirOf('outbox')
  writeFileSync(join(dir, 'outbox.json'), JSON.stringify([{ id: 'a', key: 'k', text: '1', at: 1 }]))
  const rows = new OutboxRows<O>(dir)
  const list = rows.read()
  expect(list.map((o) => o.id)).toEqual(['a'])
  list.push({ id: 'b', key: 'k', text: '2', at: 2 }, { id: 'c', key: 'k', text: '3', at: 3 })
  list.splice(1, 0, { id: 'front', key: 'k', text: '0', at: 4 })
  rows.write(list)
  expect(new OutboxRows<O>(dir).read().map((o) => o.id)).toEqual(['a', 'front', 'b', 'c'])
  rows.write(list.filter((o) => o.id !== 'b'))
  expect(new OutboxRows<O>(dir).read().map((o) => o.id)).toEqual(['a', 'front', 'c'])
})

test('what went in is kept across a restart, with the news already delivered', () => {
  const dir = dirOf('sent')
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
})

test('receipts of the older file move into the table and the older files go', () => {
  const dir = dirOf('sent')
  writeFileSync(join(dir, 'requested-news-receipts.json'), JSON.stringify(['requested-news:old']))
  writeFileSync(join(dir, 'typed.json'), '[]')
  expect(new SentLog(dir).received('requested-news:old')).toBe(true)
  expect(existsSync(join(dir, 'typed.json'))).toBe(false)
  expect(new SentLog(dir).received('requested-news:old')).toBe(true)
})
