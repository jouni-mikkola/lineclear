// The snapshot every page and refresh reads stays small: briefs and fact lines are not in it.
import { afterAll, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { src, stopSource } from './source-fixture.ts'

afterAll(stopSource)

test('the snapshot of a board with 190 tasks with long briefs is at most 200 KB', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shep-snapsize-'))
  execSync('git init -q -b main && git config user.email t@t && git config user.name T && echo hi > README.md && git add -A && git commit -qm init', {
    cwd: dir,
    shell: '/bin/sh',
  })
  const p = await src.places.add(dir, 'snapsize')
  // no sampled machine: the tasks wait as to do and start no agent
  src.engine.machine = () => undefined
  const brief = 'A long brief line that a board does not list.\n'.repeat(120)
  for (let i = 0; i < 190; i++) {
    const t = src.engine.add({ project: p.name, title: `Task number ${i} with a title`, desc: brief, by: 'test' })
    t.said = 'What it did. '.repeat(100)
    t.facts = 'branch work/x · checks passed · '.repeat(40)
  }
  const snap = src.snapshot()
  expect(snap.tasks.filter((t) => t.place.includes('snapsize')).length).toBe(190)
  expect(snap.tasks.some((t) => t.desc !== undefined || t.facts !== undefined)).toBe(false)
  expect(JSON.stringify(snap).length).toBeLessThanOrEqual(200_000)
})
