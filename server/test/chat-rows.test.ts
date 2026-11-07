// A chat's log is rows in store.sqlite: a post writes one row, the older chatlog/ folder is imported once, and a
// retired task's chat is marked archived.
import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LINECLEAR_HOME = mkdtempSync(join(tmpdir(), 'shep-chatrows-'))
const { HOME, db } = await import('../server/store.ts')
const old = join(HOME, 'chatlog')
mkdirSync(old)
writeFileSync(join(old, 'O-1_Agent.json'), JSON.stringify({ posted: [{ id: 'a', at: 1, text: 'old' }], answers: { q: 2 }, said: { q: { text: 'hi' } } }))
const { Chats } = await import('../server/live/chats.ts')
const { archiveChats } = await import('../server/live/chat-rows.ts')

const make = () =>
  new Chats(
    { record: () => undefined } as never,
    (k) => k,
    () => 'You',
  )

test('100 cards to one chat write under 100 KB and the chat reads back in order', async () => {
  const chats = make()
  const key = 'W-1/Agent'
  chats.log(key)
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  for (let i = 0; i < 100; i++) chats.post(key, { id: `c:${i}`, card: { id: `c:${i}`, text: `card ${i} ${'x'.repeat(300)}` } as never })
  await Promise.resolve()
  const wal = statSync(join(HOME, 'store.sqlite-wal')).size
  console.log(`100 cards to one chat: ${wal} bytes in the WAL`)
  expect(wal).toBeLessThan(100_000)
  chats.answer(key, 'q1', 1, 'words')
  await Promise.resolve()
  const again = make().log(key)
  expect(again.posted.map((p) => p.id)).toEqual(Array.from({ length: 100 }, (_, i) => `c:${i}`))
  expect(again.answers).toEqual({ q1: 1 })
  expect(again.said?.q1).toEqual({ text: 'words' })
})

test("the old folder is imported once and renamed, a retired task's chat is archived, a forgotten chat is gone", async () => {
  expect(existsSync(old)).toBe(false)
  const chats = make()
  expect(chats.log('O-1/Agent').posted[0].text).toBe('old')
  expect(chats.log('O-1/Agent').answers).toEqual({ q: 2 })
  archiveChats(['O-1'])
  expect(make().log('O-1/Agent').posted).toEqual([])
  chats.forget('W-1/Agent')
  await Promise.resolve()
  expect(make().log('W-1/Agent').posted).toEqual([])
})
