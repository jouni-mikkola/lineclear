import { onGitHub } from './engine-merge-fixture.ts'
import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sh, world, started } from './engine-world.ts'

const run = (headSha: string, conclusion: string, n: number) => ({
  headSha,
  status: 'completed',
  conclusion,
  url: `https://github.com/acme/app/actions/runs/${n}`,
  workflowName: 'Check',
})

test('while main is red the first merge goes and the 2nd and 3rd wait for a green run', async () => {
  const w = world()
  const g = onGitHub()
  w.engine.holdEvery = 20
  w.engine.holdMax = 5000
  const ids: string[] = []
  const merged = () => ids.filter((id) => w.engine.tasks.find((t) => t.id === id)?.merged)
  const prep = async (name: string) => {
    const { t } = await started(w, g.dir, name)
    writeFileSync(join(t.worktree!, `${name}.txt`), 'x\n')
    sh('git add -A && git commit -qm x', t.worktree!)
    ids.push(t.id)
    return t
  }
  const [t0, t1, t2, t3] = [await prep('hold0'), await prep('hold1'), await prep('hold2'), await prep('hold3')]
  const green = sh('git rev-parse main', g.bare)
  expect((await w.engine.merge(t0.id, { self: true })).ok).toBe(true)
  const red = sh('git rev-parse main', g.bare)
  // the planted red main
  g.set({ runs: [run(red, 'failure', 3), run(green, 'success', 2)], api: { 'repos/acme/app/actions/runs/3/jobs': [9] }, logs: { '9': 'boom' } })
  const r1 = await w.engine.merge(t1.id, { self: true })
  expect(r1.ok).toBe(true)
  const second = w.engine.merge(t2.id, { self: true })
  const third = w.engine.merge(t3.id, { self: true })
  await Bun.sleep(300)
  expect(merged()).toEqual([t0.id, t1.id])
  g.set({ runs: [run(sh('git rev-parse main', g.bare), 'success', 4), run(red, 'failure', 3)] })
  expect((await second).ok).toBe(true)
  expect((await third).ok).toBe(true)
  expect(merged()).toEqual(ids)
})
