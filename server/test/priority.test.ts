import { expect, test } from 'bun:test'
import { isTaskAgent, reniceArgv, treeOf, TASK_NICE } from '../server/live/priority.ts'

test('a task agent and its reviewer are lowered, a coordinator is not', () => {
  expect(isTaskAgent({ LINECLEAR_CHAT: 'LE-7/Agent' })).toBe(true)
  expect(isTaskAgent({ LINECLEAR_CHAT: 'LE-7/Reviewer' })).toBe(true)
  expect(isTaskAgent({ LINECLEAR_CHAT: 'lineclear' })).toBe(false)
  expect(isTaskAgent(undefined)).toBe(false)
})

test('the shell and everything under it get the lower priority', () => {
  const table = ' 10 1\n 11 10\n 12 11\n 13 10\n 20 1\n 21 20\n'
  expect(treeOf(10, table)).toEqual([10, 11, 13, 12])
  expect(reniceArgv(10, table)).toEqual(['renice', '-n', String(TASK_NICE), '-p', '10', '11', '13', '12'])
})

test('a started process really runs at the lower priority', () => {
  const p = Bun.spawn(['sleep', '5'])
  try {
    Bun.spawnSync(reniceArgv(p.pid, `${p.pid} 1`))
    expect(
      Number(
        Bun.spawnSync(['ps', '-o', 'ni=', '-p', String(p.pid)])
          .stdout.toString()
          .trim(),
      ),
    ).toBeGreaterThanOrEqual(TASK_NICE)
  } finally {
    p.kill()
  }
})
