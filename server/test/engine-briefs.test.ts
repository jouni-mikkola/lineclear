// A task's brief is a file under its folder; tasks.json holds the path and size.
import { describe, expect, test } from 'bun:test'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { repo, started, world } from './engine-world.ts'

describe('briefs', () => {
  test('a store of 100 tasks with their briefs inside migrates with every brief unchanged and tasks.json under 10 %', async () => {
    const { HOME } = await import('../server/store.ts')
    const now = Date.now()
    const brief = (i: number) =>
      `Build step ${i}.\n\n${`Why it matters, line ${i}: a reason that holds. `.repeat(60)}\n\nSettings: ünïcode ✓ \`code\` "quotes"\n`
    const tasks = Array.from({ length: 100 }, (_, i) => ({
      id: `BRF-${i + 1}`,
      n: i + 1,
      project: 'p:x',
      by: 't',
      title: `Task ${i + 1}`,
      desc: brief(i + 1),
      created: now - 1000,
      updated: now - 1000,
    }))
    const file = join(HOME, 'tasks.json')
    writeFileSync(file, JSON.stringify({ next: { BRF: 101 }, tasks }, null, 2))
    const before = statSync(file).size

    const w = world()
    // a change saves the store in the new form
    w.engine.pin('BRF-1', true)
    const after = statSync(file).size
    expect(after).toBeLessThan(before * 0.1)
    console.log(`tasks.json, 100 tasks: ${before} bytes before, ${after} after (${((after / before) * 100).toFixed(1)} %)`)

    const stored = JSON.parse(readFileSync(file, 'utf8')).tasks as { id: string; desc?: string; briefPath: string; briefSize: number }[]
    expect(stored).toHaveLength(100)
    for (const [i, t] of stored.entries()) {
      expect(t.desc).toBeUndefined()
      expect(t.briefPath).toBe(`tasks/BRF-${i + 1}/brief.md`)
      expect(readFileSync(join(HOME, t.briefPath), 'utf8')).toBe(brief(i + 1))
      expect(t.briefSize).toBe(Buffer.byteLength(brief(i + 1)))
    }
    // a restart reads every brief back
    const again = world().engine.tasks
    expect(again).toHaveLength(100)
    for (const [i, t] of again.entries()) expect(t.desc).toBe(brief(i + 1))
  }, 30_000)

  test('a new task has its brief in tasks/<id>/brief.md and its record holds the path and size, not the text', async () => {
    const { HOME } = await import('../server/store.ts')
    const w = world()
    const { t } = await started(w, repo(), 'briefnew', 'Brief file', 'Add hello.txt.\nÜnï ✓')
    const rec = (JSON.parse(readFileSync(join(HOME, 'tasks.json'), 'utf8')).tasks as Record<string, unknown>[]).find((x) => x.id === t.id)!
    expect(rec.briefPath).toBe(`tasks/${t.id}/brief.md`)
    expect(rec.desc).toBeUndefined()
    const text = readFileSync(join(HOME, rec.briefPath as string), 'utf8')
    expect(text).toContain('Add hello.txt.\nÜnï ✓')
    expect(rec.briefSize).toBe(Buffer.byteLength(text))
    expect(rec.briefSize).toBe(statSync(join(HOME, rec.briefPath as string)).size)
    expect(Object.keys(rec)).not.toContain('desc')
  })
})
