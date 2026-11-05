// Machine news never wakes an AI: a burst of health, news and heartbeat lines reaches no agent's pane.
import { describe, expect, test } from 'bun:test'
import { Agents, hidden } from '../server/live/agents.ts'
import { held, machineNews } from '../server/live/quiet.ts'

describe('what counts as machine news', () => {
  test('news, health and heartbeat lines', () => {
    expect(machineNews(hidden('CPU load is 9.1', 'health', { kind: 'cpu' }))).toBe('health')
    expect(machineNews(hidden('LIN-9 is done', 'news', { task: 'LIN-9' }))).toBe('news')
  })
  test('not a step start, a plain line or the owner', () => {
    expect(machineNews(hidden('Start', 'go'))).toBeUndefined()
    // the schedule or the owner's Run now: a heartbeat is the coordinator's checklist, with no news in it
    expect(machineNews(hidden('Heartbeat.', 'heartbeat'))).toBeUndefined()
    expect(machineNews(hidden('Carry on'))).toBeUndefined()
    expect(machineNews('Please look at <health> too')).toBeUndefined()
  })
})

test('a burst of health, news and heartbeat lines is held back: nothing goes into any agent', async () => {
  const a = new Agents()
  let put = 0
  ;(a as any).put = async () => void put++
  const before = held.length
  const burst = [
    hidden('CPU load is 9.1', 'health', { kind: 'cpu' }),
    hidden('Memory is at 95%', 'health', { kind: 'memory' }),
    hidden('Out of allowance until 17:00', 'news', { task: 'LIN-9', event: 'stalled' }),
    hidden('LIN-9 is done', 'news', { task: 'LIN-9', event: 'merged' }),
  ]
  for (const key of ['demo', 'LIN-9/Agent']) for (const text of burst) await a.send(key, text)
  // news a coordinator asked to hear (the requested-news mailbox) is held too
  await a.send('demo', hidden('LIN-9 is ready', 'news'), { cid: 'requested-news:1' })
  expect(put).toBe(0)
  expect(a.outbox).toEqual([])
  expect(held.length - before).toBe(9)
  a.stop()
})
