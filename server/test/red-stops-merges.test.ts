// One red stops the merges: with main red, the next merges wait for a green run.
import { onGitHub } from './engine-merge-fixture.ts'
import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sh, world, started } from './engine-world.ts'

test('3 merges on a red main: the 2nd and 3rd are held until a green run', async () => {
  const w = world()
  const g = onGitHub()
  ;(w.engine as unknown as { redWait: number }).redWait = 20
  const tasks = []
  for (const n of ['one', 'two', 'three']) {
    const { t } = await started(w, g.dir, `red${n}`)
    writeFileSync(join(t.worktree!, `${n}.txt`), `${n}\n`)
    sh(`git add -A && git commit -qm ${n}`, t.worktree!)
    tasks.push(t)
  }
  const green = sh('git rev-parse main', g.bare)
  const run = (headSha: string, conclusion: string, n: number) => ({
    headSha,
    status: 'completed',
    conclusion,
    url: `https://github.com/acme/app/actions/runs/${n}`,
    workflowName: 'Check',
  })
  expect((await w.engine.merge(tasks[0].id, { self: true })).ok).toBe(true)
  const red = sh('git rev-parse main', g.bare)
  g.set({ runs: [run(red, 'failure', 3), run(green, 'success', 2)] })

  const settled: string[] = []
  const second = w.engine.merge(tasks[1].id, { self: true }).then((r) => (settled.push('2'), r))
  const third = w.engine.merge(tasks[2].id, { self: true }).then((r) => (settled.push('3'), r))
  await Bun.sleep(400)
  expect(settled).toEqual([])
  expect(sh('git rev-parse main', g.bare)).toBe(red)

  g.set({ runs: [run('b'.repeat(40), 'success', 4), run(red, 'failure', 3)] })
  expect((await second).ok).toBe(true)
  expect((await third).ok).toBe(true)
  expect([...settled].sort()).toEqual(['2', '3'])
})
