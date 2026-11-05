import { expect, test } from 'bun:test'
import { TIMER_OFF, timerRefused } from '../server/live/timer-off.ts'

test("in Lineclear a coordinator's timer cannot be turned on; only the fork's own tests turn it on", () => {
  expect(timerRefused('autopilot', {})).toBe(TIMER_OFF)
  expect(timerRefused('regular', {})).toBeUndefined()
  expect(timerRefused('autopilot', { LINECLEAR_COORDINATOR_TIMER: 'on' })).toBeUndefined()
})

test('one rule for the server and heal: a timer is allowed only when LINECLEAR_COORDINATOR_TIMER is on', async () => {
  const { timerAllowed } = await import('../server/live/timer-rule.ts')
  expect(timerAllowed({})).toBe(false)
  expect(timerAllowed({ LINECLEAR_COORDINATOR_TIMER: 'on' })).toBe(true)
})
