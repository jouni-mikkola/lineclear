// The task list is rows in store.sqlite: a status line writes one row, the older files are imported once, a retired
// task is a mark on its row.
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LINECLEAR_HOME = mkdtempSync(join(tmpdir(), 'shep-rows-'))
const { HOME, db } = await import('../server/store.ts')
const { TaskRows } = await import('../server/live/engine/task-rows.ts')

type T = { id: string; title: string; said?: string; desc?: string; merged?: boolean }

describe('task rows', () => {
  test('45 tasks reporting 100 status lines write 100 rows and under 200 KB of the log', () => {
    const rows = new TaskRows<T>()
    const data = rows.load()
    for (let i = 0; i < 45; i++) data.tasks.push({ id: `W-${i}`, title: `Task ${i}`, said: 'x'.repeat(300), desc: 'brief '.repeat(300) })
    rows.save(data)
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const before = rows.rowWrites
    for (let i = 0; i < 100; i++) {
      data.tasks[i % 45].said = `line ${i} ${'y'.repeat(300)}`
      rows.save(data)
    }
    expect(rows.rowWrites - before).toBe(100)
    const wal = statSync(join(HOME, 'store.sqlite-wal')).size
    console.log(`100 status lines, 45 tasks: ${wal} bytes in the WAL`)
    expect(wal).toBeLessThan(200_000)
  })

  test('a save writes only what changed, a brief comes back, a deleted task is gone, a restart reads the same list', () => {
    const rows = new TaskRows<T>()
    const data = rows.load()
    const n = data.tasks.length
    data.tasks.push({ id: 'R-1', title: 'one', desc: 'Ünï ✓' }, { id: 'R-2', title: 'two' })
    data.next = { R: 3 }
    const before = rows.rowWrites
    rows.save(data)
    rows.save(data)
    expect(rows.rowWrites - before).toBe(2)
    data.tasks.splice(n, 1)
    rows.save(data)
    const again = new TaskRows<T>().load()
    expect(again.next).toEqual({ R: 3 })
    expect(again.tasks.slice(n)).toEqual([{ id: 'R-2', title: 'two' }])
  })

  test('retire marks the rows in one transaction and they leave the live list', () => {
    const rows = new TaskRows<T>()
    const data = rows.load()
    data.tasks.push({ id: 'Q-1', title: 'a', merged: true }, { id: 'Q-2', title: 'b' })
    rows.save(data)
    rows.retire(data.tasks.splice(-2, 1))
    rows.save(data)
    const marked = db.query("select id from tasks where retired = 1 and id like 'Q-%'").all()
    expect(marked).toEqual([{ id: 'Q-1' }])
    expect(
      new TaskRows<T>()
        .load()
        .tasks.filter((t) => t.id.startsWith('Q-'))
        .map((t) => t.id),
    ).toEqual(['Q-2'])
  })

  test('the older files are imported once: snapshot, hot log, cold log, brief files and the archive', () => {
    for (const t of ['tasks', 'task_briefs', 'task_meta']) db.exec(`delete from ${t}`)
    mkdirSync(join(HOME, 'tasks', 'L-1'), { recursive: true })
    mkdirSync(join(HOME, 'archive'), { recursive: true })
    writeFileSync(join(HOME, 'tasks', 'L-1', 'brief.md'), 'the brief ✓')
    writeFileSync(
      join(HOME, 'tasks.json'),
      JSON.stringify({
        next: { L: 5 },
        gen: 2,
        tasks: [
          { id: 'L-1', title: 'one', briefPath: 'tasks/L-1/brief.md', briefSize: 12 },
          { id: 'L-2', title: 'two' },
        ],
      }),
    )
    writeFileSync(
      join(HOME, 'tasks-hot.jsonl'),
      `${JSON.stringify({ gen: 2 })}\n${JSON.stringify({ id: 'L-2', title: 'two, changed' })}\n${JSON.stringify({ meta: { next: { L: 6 } } })}\n`,
    )
    writeFileSync(join(HOME, 'tasks-cold.jsonl'), `${JSON.stringify({ id: 'L-0', title: 'old', desc: 'inline' })}\n{"id":"L-9","ti`)
    writeFileSync(join(HOME, 'archive', 'tasks-2020-01.jsonl'), `${JSON.stringify({ id: 'L-A', title: 'retired', merged: true })}\n`)
    const data = new TaskRows<T>().load()
    expect(data.next).toEqual({ L: 6 })
    expect(data.tasks).toEqual([
      { id: 'L-0', title: 'old', desc: 'inline' },
      { id: 'L-1', title: 'one', desc: 'the brief ✓' },
      { id: 'L-2', title: 'two, changed' },
    ])
    expect(db.query("select id from tasks where retired = 1 and id = 'L-A'").all()).toHaveLength(1)
    for (const f of ['tasks.json', 'tasks-hot.jsonl', 'tasks-cold.jsonl']) {
      expect(existsSync(join(HOME, f))).toBe(false)
      expect(existsSync(join(HOME, `${f}.imported`))).toBe(true)
    }
    // a second load reads the rows: the file left over is not imported again
    writeFileSync(join(HOME, 'tasks.json'), JSON.stringify({ tasks: [{ id: 'Z-1', title: 'stray' }] }))
    expect(new TaskRows<T>().load().tasks.map((t) => t.id)).toEqual(['L-0', 'L-1', 'L-2'])
    expect(readFileSync(join(HOME, 'tasks.json.imported'), 'utf8')).toContain('stray')
  })
})
