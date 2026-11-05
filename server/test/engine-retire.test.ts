// Retiring: ended tasks leave tasks.json, for the archive after 90 days and for an append log after a day.
import { describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { world } from './engine-world.ts'

const day = 86_400_000
const now = Date.now()
const linesOf = (f: string) =>
  readFileSync(f, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
const base = { n: 1, project: 'p:x', by: 't', created: 1, merged: true, cleaned: true }
const rec = (id: string, ago: number, more = {}, desc = '') => ({ ...base, id, title: id, desc, updated: now - ago * day, doneAt: now - ago * day, ...more })
type Rec = ReturnType<typeof rec>

describe('retiring', () => {
  test('ended tasks leave tasks.json after 90 days with their chats; the rest stay; a restart reads them gone', async () => {
    const { HOME } = await import('../server/store.ts')
    const { mkdirSync, readdirSync } = await import('node:fs')
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
    mkdirSync(join(HOME, 'chatlog'), { recursive: true })
    for (const f of ['RET-1_Agent.json', 'RET-1_Ask.json', 'RET-10_Agent.json', 'RET-3_Agent.json']) writeFileSync(join(HOME, 'chatlog', f), '{"posted":[]}')
    expect(w.engine.retireOld(now)).toBe(2)
    // their agents' records go with them
    expect(w.forgot.filter((k) => k.startsWith('RET-'))).toEqual(['RET-1/Agent', 'RET-2/Agent'])
    expect(w.engine.tasks.map((t) => t.id)).toEqual(['RET-3', 'RET-4', 'RET-5', 'RET-6'])
    expect(world().engine.task('RET-1')).toBeUndefined()
    const archived = readdirSync(join(HOME, 'archive')).filter((f) => f.startsWith('tasks-'))
    const lines = archived.flatMap((f) => linesOf(join(HOME, 'archive', f))).map((l) => l.id)
    expect(lines.sort()).toEqual(['RET-1', 'RET-2'])
    expect(JSON.parse(readFileSync(join(HOME, 'archive', 'counts.json'), 'utf8')).RET).toEqual({ merged: 1, closed: 1 })
    expect(readdirSync(join(HOME, 'archive', 'chatlog')).sort()).toEqual(['RET-1_Agent.json', 'RET-1_Ask.json'])
    const left = readdirSync(join(HOME, 'chatlog')).filter((f) => f.startsWith('RET'))
    expect(left.sort()).toEqual(['RET-10_Agent.json', 'RET-3_Agent.json'])
    expect(w.engine.retireOld(now)).toBe(0)
  }, 30_000)

  test('tasks ended over a day ago leave tasks.json for an append log: a change writes one line; a restart reads them all', async () => {
    const { HOME } = await import('../server/store.ts')
    const { COLD_FILE } = await import('../server/live/engine/cold.ts')
    const { rmSync } = await import('node:fs')
    rmSync(join(HOME, COLD_FILE), { force: true })
    const w = world()
    const tasks = w.engine.tasks as unknown as Rec[]
    const big = 'x'.repeat(1000)
    tasks.splice(
      0,
      tasks.length,
      rec('COLD-1', 2, {}, big),
      rec('COLD-2', 5, { merged: false, closed: true }, big),
      rec('COLD-3', 0.5, {}, big),
      rec('COLD-4', 3, { merged: false }, big),
    )
    w.engine.pin('COLD-4', true)
    const hot = () => (JSON.parse(readFileSync(join(HOME, 'tasks.json'), 'utf8')).tasks as { id: string }[]).map((t) => t.id)
    const log = () => linesOf(join(HOME, COLD_FILE))
    // the one still at work, and the one ended half a day ago, are written whole; the rest once
    expect(hot()).toEqual(['COLD-3', 'COLD-4'])
    expect(log().map((l) => l.id)).toEqual(['COLD-1', 'COLD-2'])
    w.engine.pin('COLD-4', false)
    expect(log()).toHaveLength(2)
    // a change to a cold task is one line; nothing else is written again
    w.engine.pin('COLD-1', true)
    expect(log().map((l) => l.id)).toEqual(['COLD-1', 'COLD-2', 'COLD-1'])
    expect(hot()).toEqual(['COLD-3', 'COLD-4'])
    expect(world().engine.tasks.map((t) => [t.id, !!t.pinned])).toEqual([
      ['COLD-1', true],
      ['COLD-2', false],
      ['COLD-3', false],
      ['COLD-4', false],
    ])
    // gone from the list (deleted or retired): a line says so, and a restart does not bring it back
    tasks.splice(1, 1)
    w.engine.pin('COLD-1', false)
    expect(log().at(-1)).toEqual({ gone: 'COLD-2' })
    expect(world().engine.tasks.map((t) => t.id)).toEqual(['COLD-1', 'COLD-3', 'COLD-4'])
  }, 30_000)
})
