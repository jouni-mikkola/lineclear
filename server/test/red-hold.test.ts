// While main is red, the first merge goes through (it may be the fix), the 2nd and 3rd wait for a green run.
import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { onGitHub } from './engine-merge-fixture.ts'
import { sh, started, world } from './engine-world.ts'

test('3 merges on a red main: the 2nd and 3rd are held until it is green', async () => {
  const w = world()
  const g = onGitHub()
  const tasks: Awaited<ReturnType<typeof started>>['t'][] = []
  for (const n of ['one', 'two', 'three']) {
    const { t } = await started(w, g.dir, `hold${n}`)
    writeFileSync(join(t.worktree!, `${n}.txt`), `${n}\n`)
    sh('git add -A && git commit -qm x', t.worktree!)
    tasks.push(t)
  }
  const p = w.places.space(tasks[0].project)!
  const data = (w.engine as unknown as { data: { red?: Record<string, string> } }).data
  data.red = { [p.path]: 'b'.repeat(40) }
  const merge = (i: number) => w.engine.merge(tasks[i].id, { self: true })
  // a first merge that fails (a conflict marker) does not use up the turn
  writeFileSync(join(tasks[0].worktree!, 'bad.txt'), '<<<<<<< x\n=======\n>>>>>>> y\n')
  sh('git add -A && git commit -qm bad', tasks[0].worktree!)
  expect((await merge(0)).ok).toBe(false)
  sh('git rm -q bad.txt && git commit -qm fix', tasks[0].worktree!)
  expect((await merge(0)).ok).toBe(true)
  const second = await merge(1)
  expect(second.ok).toBe(false)
  expect(second.error).toContain('waits for a green run')
  expect((await merge(2)).ok).toBe(false)
  delete data.red[p.path]
  expect((await merge(1)).ok).toBe(true)
  expect((await merge(2)).ok).toBe(true)
})
