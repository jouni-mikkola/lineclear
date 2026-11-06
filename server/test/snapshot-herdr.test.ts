// The snapshot a client reads (/api/snapshot) carries what herdr's events kept of each task's agent.
import { afterAll, expect, test } from 'bun:test'
import { src, stopSource, workedTask } from './source-fixture.ts'

afterAll(stopSource)

test('a task agent in the snapshot has status, session, pasted and at from herdr', async () => {
  const { t } = await workedTask('snapherdr')
  const key = (src.engine as unknown as { key(t: unknown): string }).key(t)
  const kept = src.agents as unknown as {
    records: Record<string, unknown>
    paste: { shown: Set<string> }
    take(list: unknown[]): void
    heard(e: unknown): void
  }
  const pane = {
    pane_id: 'w1:p1',
    agent: 'pi',
    name: 'shep-snap',
    agent_status: 'idle',
    interactive_ready: true,
    agent_session: { kind: 'path', value: '/s/pi.jsonl' },
  }
  kept.records[key] = { key, name: 'shep-snap', started: 0, kind: 'pi', logs: [] }
  kept.paste.shown.add(key)
  const before = Date.now()
  kept.take([pane])
  kept.heard({ event: 'pane_agent_status_changed', data: { pane_id: 'w1:p1', agent_status: 'working' } })
  const task = JSON.parse(JSON.stringify(src.snapshot())).tasks.find((x: { id: string }) => x.id === t.id)
  expect(task.agent.herdr).toEqual({ status: 'working', session: '/s/pi.jsonl', pasted: true, at: expect.any(Number) })
  expect(task.agent.herdr.at).toBeGreaterThanOrEqual(before)
})
