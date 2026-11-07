import { describe, expect, test } from 'bun:test'
import type { AgentInfo } from '../server/live/herdr.ts'
import { holdFrom, ownOldPane } from '../server/live/agent-start.ts'

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

describe('ownOldPane', () => {
  const at = (pane_id: string, name: string) => ({ pane_id, name }) as AgentInfo
  const used = new Error('agent name shep-lin-1 is already used')
  test("frees only the pane that holds the task agent's own name", () => {
    const list = [at('p1', 'shep-lin-1'), at('p2', 'shep-lin-2'), at('p3', 'shep-lin-1')]
    expect(ownOldPane(used, list, 'shep-lin-1', 'p3')).toBe('p1')
    expect(ownOldPane(used, [at('p2', 'shep-lin-2')], 'shep-lin-1', 'p3')).toBeUndefined()
  })
  test('other refusals free nothing', () => {
    expect(ownOldPane(new Error('boom'), [at('p1', 'shep-lin-1')], 'shep-lin-1', 'p3')).toBeUndefined()
  })
})
