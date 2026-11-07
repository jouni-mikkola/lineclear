// Putting a task away asks herdr for its spaces once, and a herdr that times out is told apart from a space that is gone.
import { describe, expect, test } from 'bun:test'
import { HerdrError } from '../server/live/herdr.ts'
import { Worktrees, type HerdrSpaces } from '../server/live/engine/worktrees.ts'

function stub(over: Partial<Record<keyof HerdrSpaces, unknown>> = {}) {
  const calls: string[] = []
  const spaces = Array.from({ length: 45 }, (_, i) => ({ workspace_id: `w${i}`, label: `task-${i}`, tab_count: 1 }))
  const note = (name: string, value: unknown) => async () => {
    calls.push(name)
    return value
  }
  const h = {
    workspaces: note('workspaces', spaces),
    agents: note('agents', []),
    panes: note('panes', []),
    tabs: note('tabs', []),
    paneIdle: note('paneIdle', true),
    closeWorkspace: note('closeWorkspace', undefined),
    ...over,
  } as unknown as HerdrSpaces
  return { h, calls }
}

const away = (w: InstanceType<typeof Worktrees>) => w.putAway({ repo: '/nonexistent-repo', base: 'main', label: 'task-7', closeAgent: async () => undefined })

describe('putAway and herdr', () => {
  test('lists the spaces once', async () => {
    const { h, calls } = stub()
    const r = await away(new Worktrees(h))
    expect(r.busy).toBeUndefined()
    expect(calls.filter((c) => c === 'workspaces')).toHaveLength(1)
    expect(calls).toContain('closeWorkspace')
  })

  test('a space already gone counts as done', async () => {
    const { h } = stub({
      closeWorkspace: async () => {
        throw new HerdrError('workspace_not_found', 'no such workspace')
      },
    })
    const r = await away(new Worktrees(h))
    expect(r.busy).toBeUndefined()
    expect(r.kept).toEqual([])
  })

  test('a timeout leaves it to try again, with the error told', async () => {
    const { h } = stub({
      closeWorkspace: async () => {
        throw new HerdrError('timeout', 'herdr workspace.close timed out')
      },
    })
    const r = await away(new Worktrees(h))
    expect(r.busy).toBe(true)
    expect(r.kept[0]).toContain('timed out')
  })
})
