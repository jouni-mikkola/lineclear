// A task agent's snapshot carries what herdr last said of it, with no read of herdr.
import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LINECLEAR_HOME = mkdtempSync(join(tmpdir(), 'shep-view-'))
const { Agents } = await import('../server/live/agents.ts')

test('herdrView gives status, session path, pasted and the time heard', () => {
  type Kept = { records: Record<string, unknown>; live: Map<string, unknown>; pasted: Set<string>; heardAt: number }
  const a = new Agents() as unknown as InstanceType<typeof Agents> & Kept
  ;(a.records as Record<string, unknown>).T1 = { key: 'T1', name: 'shep-t1', started: 0 }
  expect(a.herdrView('T1')).toBeUndefined()
  a.live.set('shep-t1', { name: 'shep-t1', agent_status: 'working', agent_session: { kind: 'path', value: '/s/x.jsonl' } })
  a.heardAt = 42
  expect(a.herdrView('T1')).toEqual({ status: 'working', session: '/s/x.jsonl', pasted: false, at: 42 })
  a.pasted.add('T1')
  expect(a.herdrView('T1')?.pasted).toBe(true)
})
