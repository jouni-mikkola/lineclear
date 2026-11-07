import { stopSource, placeId, src } from './source-fixture.ts'
import { afterAll, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { landedIn, stepIdOfTitle, whyStepRefused } from '../server/live/engine/step-once.ts'

test('a step id is read from the start of a title', () => {
  expect(stepIdOfTitle('L461 One agent per step')).toBe('L461')
  expect(stepIdOfTitle('Fix the login')).toBeUndefined()
  expect(stepIdOfTitle('IPv6 support')).toBeUndefined()
})

test('a reverted merge does not count as landed', () => {
  const merged = { subject: 'LIN-9: L461 One agent (#1)', body: '' }
  expect(landedIn([merged], 'L461')).toBe(true)
  expect(landedIn([{ subject: `Revert "${merged.subject}"`, body: '' }, merged], 'L461')).toBe(false)
  expect(whyStepRefused('Plain', [], [merged])).toBeUndefined()
})

test('the same step added twice starts once and is refused once; a landed step starts nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shep-once-repo-'))
  execSync(
    'git init -q -b main && git config user.email t@t && git config user.name T && echo hi > README.md && git add -A && git commit -qm init && git commit -q --allow-empty -m "LIN-9: L7 Landed step (#1)"',
    { cwd: dir, shell: '/bin/sh' },
  )
  const place = placeId.space((await src.places.add(dir, 'once-source')).name)
  const before = src.engine.tasks.length
  const first = await src.cli(['task', 'add', 'L9 Open step', '--desc', 'x'], { chat: place })
  expect(first.code).toBe(0)
  const second = await src.cli(['task', 'add', 'L9 Open step', '--desc', 'x'], { chat: place })
  expect(second.code).toBe(1)
  expect(second.out).toContain('one agent per step')
  const landed = await src.cli(['task', 'add', 'L7 Landed step', '--desc', 'x'], { chat: place })
  expect(landed.code).toBe(1)
  expect(landed.out).toContain('has landed')
  expect(src.engine.tasks.length).toBe(before + 1)
  const again = await src.cli(['task', 'add', 'L7 Landed step', '--desc', 'x', '--reopened', 'true'], { chat: place })
  expect(again.code).toBe(0)
})

test('one step added at the same instant from 2 machines starts once; 20 races start none twice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shep-race-repo-'))
  execSync('git init -q -b main && git config user.email t@t && git config user.name T && echo hi > README.md && git add -A && git commit -qm init', {
    cwd: dir,
    shell: '/bin/sh',
  })
  const place = placeId.space((await src.places.add(dir, 'race-source')).name)
  const before = src.engine.tasks.length
  let twice = 0
  for (let i = 0; i < 20; i++) {
    const title = `L${900 + i} Raced step`
    const n = src.engine.tasks.length
    const results = await Promise.all([
      src.cli(['task', 'add', title, '--desc', 'x'], { chat: place }),
      src.cli(['task', 'add', title, '--desc', 'x'], { chat: place }),
    ])
    if (src.engine.tasks.length - n !== 1) twice++
    const refused = results.filter((r) => r.code === 1)
    expect(refused.length).toBe(1)
    expect(refused[0]?.out).toMatch(/already/)
  }
  expect(twice).toBe(0)
  expect(src.engine.tasks.length).toBe(before + 20)
})

afterAll(stopSource)
