// A fault of the base that lost an agent's brief: herdr lists a just started agent without its name.
import { describe, expect, spyOn, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentInfo } from '../server/live/herdr.ts'

// no herdr is reached: every call that is not mocked fails at once
process.env.HERDR_SOCKET_PATH = join(tmpdir(), 'no-herdr-known-faults.sock')
const { Agents } = await import('../server/live/agents.ts')
const { herdr } = await import('../server/live/herdr.ts')

const key = 'T-1/Agent'
const listed = (o: Partial<AgentInfo>): AgentInfo => ({ agent: 'pi', agent_status: 'idle', cwd: '/x', pane_id: 'p1', tab_id: 't', workspace_id: 'w', ...o })

function agents() {
  const a = new Agents()
  Object.assign(a, { sub: { set: () => undefined, stop: () => undefined } })
  a.records[key] = { key, name: 'shep-t-1', kind: 'pi', cwd: '/x', workspace: 'w', logs: [], started: Date.now() }
  return a
}

describe('an agent herdr lists without its name', () => {
  test('is named again, so what waits for it goes in', async () => {
    const a = agents()
    ;(a as unknown as { startedIn: Map<string, string> }).startedIn.set(key, 'p1')
    const list = spyOn(herdr, 'snapshot').mockResolvedValue([listed({ name: null })])
    const rename = spyOn(herdr, 'rename').mockResolvedValue(undefined as never)
    try {
      await a.refresh()
      await Bun.sleep(20)
      expect(rename).toHaveBeenCalledWith('p1', 'shep-t-1')
      // another pane's unnamed agent is none of its business
      rename.mockClear()
      list.mockResolvedValue([listed({ name: null, pane_id: 'p2' })])
      await a.refresh()
      await Bun.sleep(20)
      expect(rename).not.toHaveBeenCalled()
    } finally {
      list.mockRestore()
      rename.mockRestore()
      a.stop()
    }
  })
})

describe('an agent that was at work when the machine went down', () => {
  test('is remembered as working from its record, which is on disk', () => {
    const a = agents()
    try {
      expect(a.wasWorking(key)).toBe(false)
      ;(a as unknown as { changed: (k: string, s: string) => void }).changed(key, 'working')
      expect(a.records[key].working).toBe(true)
      expect(a.wasWorking(key)).toBe(true)
      ;(a as unknown as { changed: (k: string, s: string) => void }).changed(key, 'gone')
      expect(a.wasWorking(key)).toBe(true)
      ;(a as unknown as { changed: (k: string, s: string, w?: string) => void }).changed(key, 'idle', 'working')
      expect(a.wasWorking(key)).toBe(false)
    } finally {
      a.stop()
    }
  })

  test('is told to carry on when its service starts it again', async () => {
    const { LiveSource: Source } = await import('../server/live/source.ts')
    const a = agents()
    a.records[key].working = true
    // its first look after the service started shows the restored pane idle: that does not wipe the flag
    ;(a as unknown as { changed: (k: string, s: string, w?: string) => void }).changed(key, 'idle')
    expect(a.records[key].working).toBe(true)
    const sent: string[] = []
    const fake = {
      agents: Object.assign(a, {
        relaunch: async (_k: string, _c: boolean, start: () => Promise<unknown>) => void (await start()),
        send: async (_k: string, t: string) => void sent.push(t),
      }),
      revivals: { wasWorking: () => false },
      reviving: new Set<string>(),
      emit: () => undefined,
      resumeTaskAgent: async () => undefined,
    }
    try {
      await (Source.prototype as unknown as { relaunch: (this: unknown, k: string, w: string) => Promise<void> }).relaunch.call(fake, key, 'gone')
      expect(sent).toHaveLength(1)
      expect(sent[0]).toContain('Carry on')
    } finally {
      a.stop()
    }
  })
})

describe('an agent that stopped', () => {
  test('is started again: relaunch lets its start through ensure()', async () => {
    const a = agents()
    const started = listed({ name: 'shep-t-1' })
    Object.assign(a, { launch: async () => started })
    const spec = { key, name: 'shep-t-1', kind: 'pi', cwd: '/x', workspace: 'w' }
    try {
      let got: unknown
      await a.relaunch(key, false, async () => {
        got = await a.ensure(spec as never)
      })
      expect(got).toBe(started)
      expect(a.busy(key)).toBe(false)
    } finally {
      a.stop()
    }
  })
})
