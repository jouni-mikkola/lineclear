// A message to an RPC agent is one prompt that says what pi did with it.
import { expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentInfo } from '../server/live/herdr.ts'
import type { RpcAgent } from '../server/live/agent-rpc.ts'

process.env.HERDR_SOCKET_PATH = join(tmpdir(), 'no-herdr-agent-prompt.sock')
const { Agents } = await import('../server/live/agents.ts')

const key = 'T-1/Agent'

function rpcAgent(prompt: (text: string) => Promise<string>) {
  const a = new Agents()
  Object.assign(a, { sub: { set: () => undefined, stop: () => undefined } })
  a.records[key] = { key, name: 'shep-t-1', kind: 'pi', cwd: '/x', workspace: 'w', logs: [], started: Date.now() }
  a.live.set('shep-t-1', { agent: 'pi', agent_status: 'working', cwd: '/x', pane_id: 'rpc:T-1', tab_id: '', workspace_id: '', name: 'shep-t-1' } as AgentInfo)
  a.rpcs.set(key, { prompt, stop: () => undefined } as unknown as RpcAgent)
  return a
}

test('a send while the agent works says queued', async () => {
  const a = rpcAgent(async () => 'queued')
  try {
    expect(await a.send(key, 'One more thing')).toMatchObject({ waiting: false, disposition: 'queued' })
  } finally {
    a.stop()
  }
})

test('a brief of 3 items is in the agent in under 1 s, in order', async () => {
  const got: string[] = []
  const a = rpcAgent(async (text) => (got.push(text), 'started'))
  a.live.get('shep-t-1')!.agent_status = 'idle'
  try {
    a.beforeInput = async () => undefined
    ;(a as unknown as { queue(k: string, t: string[], ahead: boolean, brief: boolean): void }).queue(key, ['one', 'two', 'three'], true, true)
    const t = Date.now()
    await a.deliver(key)
    expect(got).toEqual(['one', 'two', 'three'])
    expect(Date.now() - t).toBeLessThan(1000)
    expect(a.waiting(key)).toHaveLength(0)
  } finally {
    a.stop()
  }
})
