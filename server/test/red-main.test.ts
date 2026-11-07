// A commit that turns main red is reverted and gets a fix task within 10 simulated minutes.
import { expect, test } from 'bun:test'
import { MergeGate, RedMainWatch, type MainRun } from '../server/live/engine/lane-watch.ts'

const MIN = 60_000

test('a planted red main is reverted and gets a fix task within 10 minutes', async () => {
  process.env.LINECLEAR_CONFIG = `/tmp/red-main-${process.pid}`
  const watch = new RedMainWatch()
  const log: string[] = []
  const act = {
    revert: async (sha: string) => (log.push(`revert ${sha}`), true),
    fixTask: async (sha: string, reverted: boolean) => void log.push(`task ${sha} ${reverted}`),
  }
  let run: MainRun | undefined = { sha: 'aaa1111', conclusion: 'success' }
  const redAt = 3 * MIN
  let doneAt: number | undefined
  for (let t = 0; t <= 20 * MIN; t += MIN) {
    if (t === redAt) run = { sha: 'bbb2222', conclusion: 'failure' }
    if ((await watch.look(run, act)) && doneAt === undefined) doneAt = t
  }
  expect(doneAt! - redAt).toBeLessThanOrEqual(10 * MIN)
  expect(log).toEqual(['revert bbb2222', 'task bbb2222 true'])
})

test('three merges on a red main: the 2nd and 3rd wait for a green run', async () => {
  const gate = new MergeGate()
  let red = true
  const through: number[] = []
  const merge = (n: number) => gate.pass('repo', () => red).then(() => void through.push(n))
  const all = [merge(1), merge(2), merge(3)]
  await Bun.sleep(20)
  expect(through).toEqual([1])
  red = false
  gate.release('repo')
  await Promise.all(all)
  expect(through).toEqual([1, 2, 3])
})

test('a failed revert still opens the fix task, and a green main does nothing', async () => {
  process.env.LINECLEAR_CONFIG = `/tmp/red-main-${process.pid}`
  const watch = new RedMainWatch()
  const tasks: boolean[] = []
  const act = { revert: async () => false, fixTask: async (_: string, r: boolean) => void tasks.push(r) }
  expect(await watch.look({ sha: 'c', conclusion: 'success' }, act)).toBeUndefined()
  expect(await watch.look({ sha: 'd', conclusion: 'failure' }, act)).toBe('task only')
  expect(tasks).toEqual([false])
})
