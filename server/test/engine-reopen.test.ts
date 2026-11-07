// A closed task whose branch kept its work: its folder went, and writing to it makes the folder again from the branch.
import { expect, setDefaultTimeout, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { repo, sh, started, world } from './engine-world.ts'

setDefaultTimeout(60_000)

test('writing to a closed task with work in its branch opens that work again in its folder', async () => {
  const w = world()
  const dir = repo()
  const { t, key } = await started(w, dir, 'reopens')
  const wt = t.worktree as string
  writeFileSync(join(wt, 'wip.txt'), 'wip\n')
  sh('git add -A && git commit -qm wip', wt)
  await w.engine.close(t.id, 'Not needed any more.', undefined, true)
  expect(existsSync(wt)).toBe(false)
  const before = w.started.length
  await w.engine.resume(t.id)
  expect(readFileSync(join(wt, 'wip.txt'), 'utf8')).toBe('wip\n')
  expect(w.started.slice(before).map((s) => [s.key, s.cwd])).toEqual([[key, wt]])
})
