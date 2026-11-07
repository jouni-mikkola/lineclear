// One red stops the merges, but never deadlocks: a held merge answers at once and does not hold the repo's lane.
import { onGitHub } from './engine-merge-fixture.ts'
import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sh, world, started, until } from './engine-world.ts'

const run = (headSha: string, conclusion: string, n: number) => ({
  headSha,
  status: 'completed',
  conclusion,
  url: `https://github.com/acme/app/actions/runs/${n}`,
  workflowName: 'Check',
})

async function commit(w: ReturnType<typeof world>, dir: string, n: string, title?: string) {
  const { t } = await started(w, dir, `red${n}`, title)
  writeFileSync(join(t.worktree!, `${n}.txt`), `${n}\n`)
  sh(`git add -A && git commit -qm ${n}`, t.worktree!)
  return t
}

test('on a red main a merge answers at once with why, and a fix task still merges', async () => {
  const w = world()
  const g = onGitHub()
  const [one, two, fix] = [await commit(w, g.dir, 'one'), await commit(w, g.dir, 'two'), await commit(w, g.dir, 'fix')]
  fix.by = 'main-green'
  expect((await w.engine.merge(one.id, { self: true })).ok).toBe(true)
  const red = sh('git rev-parse main', g.bare)
  g.set({ runs: [run(red, 'failure', 3)] })

  const held = await w.engine.merge(two.id, { self: true })
  expect(held.ok).toBe(false)
  expect(held.error).toContain(`red at ${red.slice(0, 7)}`)
  expect(held.error).toContain(`fix task ${fix.id}`)
  expect(two.merged).toBeFalsy()

  expect((await w.engine.merge(fix.id, { self: true })).ok).toBe(true)
})

test('once main is green again, the held ready tasks land without anyone running merge', async () => {
  const w = world()
  const g = onGitHub()
  const first = await commit(w, g.dir, 'first')
  expect((await w.engine.merge(first.id, { self: true })).ok).toBe(true)
  const red = sh('git rev-parse main', g.bare)
  g.set({ runs: [run(red, 'failure', 3)] })

  const tasks: Awaited<ReturnType<typeof commit>>[] = []
  for (const n of ['a', 'b']) {
    const { t, key } = await started(w, g.dir, `held${n}`)
    writeFileSync(join(t.worktree!, `${n}.txt`), `${n}\n`)
    sh(`git add -A && git commit -qm ${n}`, t.worktree!)
    await w.engine.done(t.id, `Added ${n}.`)
    w.agentIs(key, 'idle')
    await until(() => w.engine.statusOf(t) === 'ready')
    tasks.push(t)
  }
  await w.engine.landReady()
  await until(() => tasks.every((t) => t.mergeStopped?.startsWith('Held:')))
  await until(() => tasks.every((t) => t.landTriedAt !== undefined))
  expect(tasks.some((t) => t.merged)).toBe(false)

  g.set({ runs: [run('b'.repeat(40), 'success', 4), run(red, 'failure', 3)] })
  // the retry for a held merge is short: let it pass
  for (const t of tasks) t.landTriedAt = Date.now() - 10 * 60_000
  await w.engine.landReady()
  await until(() => tasks.every((t) => !!t.merged))
})

test('a failing workflow that is not the required check holds no merge', async () => {
  const w = world()
  const g = onGitHub()
  ;(w.engine as unknown as { redWait: number }).redWait = 20
  const { t } = await started(w, g.dir, 'installred')
  writeFileSync(join(t.worktree!, 'x.txt'), 'x\n')
  sh('git add -A && git commit -qm x', t.worktree!)
  const head = sh('git rev-parse main', g.bare)
  const run = (workflowName: string, conclusion: string, n: number) => ({
    headSha: head,
    status: 'completed',
    conclusion,
    url: `https://github.com/acme/app/actions/runs/${n}`,
    workflowName,
  })
  g.set({ runs: [run('install', 'failure', 6), run('check', 'success', 5)] })
  expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
})
