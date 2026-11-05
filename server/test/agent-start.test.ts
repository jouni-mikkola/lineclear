import { describe, expect, test } from 'bun:test'
import { holdFrom } from '../server/live/agent-start.ts'

describe('holdFrom', () => {
  test('a blocked agent means a menu is up', () => {
    expect(holdFrom({ code: 'agent_blocked' })).toBe('menu')
  })
  test.each(['agent_not_found', 'agent_not_ready', 'agent_not_running'])('%s means the agent is starting', (code) => {
    expect(holdFrom({ code })).toBe('start')
  })
  test('the named-agent refusal means the agent is starting', () => {
    expect(holdFrom(Object.assign(new Error('agent shep-all is not an active named agent'), { code: 'other' }))).toBe('start')
  })
  test('anything else cannot go in', () => {
    expect(holdFrom({ code: 'nope' })).toBeUndefined()
  })
})
