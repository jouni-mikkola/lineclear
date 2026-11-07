// Retiring: ended tasks are marked retired after 90 days, all in one transaction, and their chats move to the archive.
import { describe, expect, test } from 'bun:test'
import { world } from './engine-world.ts'

const day = 86_400_000
const now = Date.now()
const base = { n: 1, project: 'p:x', by: 't', created: 1, merged: true, cleaned: true }
const rec = (id: string, ago: number, more = {}, desc = '') => ({ ...base, id, title: id, desc, updated: now - ago * day, doneAt: now - ago * day, ...more })
type Rec = ReturnType<typeof rec>

describe('retiring', () => {
  test('ended tasks are marked retired after 90 days with their chats; the rest stay; a restart reads them gone', async () => {
    const { db } = await import('../server/store.ts')
    const { ChatRows } = await import('../server/live/chat-rows.ts')
    const w = world()
    const tasks = w.engine.tasks as unknown as Rec[]
    tasks.push(
      rec('RET-1', 100),
      rec('RET-2', 95, { merged: false, closed: true }),
      rec('RET-3', 10),
      rec('RET-4', 200, { pinned: 1 }),
      rec('RET-5', 120, { merged: false }),
      rec('RET-6', 300),
    )
    w.status['RET-6/Agent'] = 'working'
    tasks.splice(0, tasks.length - 6)
    const chatRows = new ChatRows()
    for (const chat of ['RET-1_Agent', 'RET-1_Ask', 'RET-10_Agent', 'RET-3_Agent']) {
      chatRows.save(chat, { posted: [{ id: 'a', at: 1 }], answers: {} })
    }
    chatRows.flush()
    expect(w.engine.retireOld(now)).toBe(2)
    // their agents' records go with them
    expect(w.forgot.filter((k) => k.startsWith('RET-'))).toEqual(['RET-1/Agent', 'RET-2/Agent'])
    expect(w.engine.tasks.map((t) => t.id)).toEqual(['RET-3', 'RET-4', 'RET-5', 'RET-6'])
    expect(world().engine.task('RET-1')).toBeUndefined()
    const marked = db.query("select id from tasks where retired = 1 and id like 'RET-%' order by id").all() as { id: string }[]
    expect(marked.map((r) => r.id)).toEqual(['RET-1', 'RET-2'])
    const chats = (archived: number) =>
      (db.query('select chat from chatlog where archived = ? and chat like ? order by chat').all(archived, 'RET-%') as { chat: string }[]).map((r) => r.chat)
    expect(chats(1)).toEqual(['RET-1_Agent', 'RET-1_Ask'])
    expect(chats(0)).toEqual(['RET-10_Agent', 'RET-3_Agent'])
    expect(w.engine.retireOld(now)).toBe(0)
  }, 30_000)
})
