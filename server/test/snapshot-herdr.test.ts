// The snapshot a client reads (/api/snapshot) carries what herdr's events kept of each task's agent.
import { afterAll, expect, test } from 'bun:test'
import { src, stopSource, workedTask } from './source-fixture.ts'

afterAll(stopSource)

test('a task agent in the snapshot has status, session, pasted and at from herdr', async () => {
  const { t } = await workedTask('snapherdr')
  const key = src.engine.key(t)
  const kept = src.agents as unknown as { records: Record<string, unknown>; live: Map<string, unknown>; paste: { shown: Set<string> }; heardAt: number }
  kept.records[key] = { key, name: 'shep-snap', started: 0, kind: 'pi', logs: [] }
  kept.live.set('shep-snap', { name: 'shep-snap', agent_status: 'working', agent_session: { kind: 'path', value: '/s/pi.jsonl' } })
  kept.paste.shown.add(key)
  kept.heardAt = 1234
  const task = JSON.parse(JSON.stringify(src.snapshot())).tasks.find((x: { id: string }) => x.id === t.id)
  expect(task.agent.herdr).toEqual({ status: 'working', session: '/s/pi.jsonl', pasted: true, at: 1234 })
})
