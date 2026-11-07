import { describe, expect, test } from 'bun:test'
import type { AgentInfo } from '../server/live/herdr.ts'
import { ownOldPane } from '../server/live/agents-helpers.ts'

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
