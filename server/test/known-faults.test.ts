// Faults of the base that lost an agent's brief: herdr lists a just started agent without its name, and a brief pasted
// into a CLI that is still starting is never submitted.
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

describe('a brief pasted while the CLI starts', () => {
  const put = (a: InstanceType<typeof Agents>, text: string) =>
    (a as unknown as { put: (k: string, i: unknown) => Promise<void> }).put(key, { id: 'i', key, text, at: Date.now() })

  test('gets its Enter again when the agent just started is still idle after it', async () => {
    const a = agents()
    a.submitMs = 10
    a.live.set('shep-t-1', listed({ name: 'shep-t-1' }))
    const prompt = spyOn(herdr, 'prompt').mockResolvedValue(undefined as never)
    const keys = spyOn(herdr, 'paneKeys').mockImplementation((async () => {
      a.live.set('shep-t-1', listed({ name: 'shep-t-1', agent_status: 'working' }))
    }) as never)
    try {
      await put(a, 'Do the work.')
      await Bun.sleep(60)
      expect(keys).toHaveBeenCalledWith('p1', ['enter'])
    } finally {
      prompt.mockRestore()
      keys.mockRestore()
      a.stop()
    }
  })

  test('a pane that swallows the first Enter and holds the brief unsent gets Enter until the agent works', async () => {
    const a = agents()
    a.submitMs = 10
    a.live.set('shep-t-1', listed({ name: 'shep-t-1' }))
    const prompt = spyOn(herdr, 'prompt').mockResolvedValue(undefined as never)
    const visible = spyOn(herdr, 'visible').mockResolvedValue('[paste #1 +40 lines]\n❯ ' as never)
    // the first Enter is swallowed, the second one submits
    let pressed = 0
    const keys = spyOn(herdr, 'paneKeys').mockImplementation((async () => {
      if (++pressed >= 2) a.live.set('shep-t-1', listed({ name: 'shep-t-1', agent_status: 'working' }))
    }) as never)
    try {
      await put(a, 'Do the work.')
      for (let i = 0; i < 40 && a.status(key) !== 'working'; i++) await Bun.sleep(50)
      expect(a.status(key)).toBe('working')
      expect(keys).toHaveBeenCalledTimes(2)
      expect(prompt).toHaveBeenCalledTimes(1)
    } finally {
      prompt.mockRestore()
      visible.mockRestore()
      keys.mockRestore()
      a.stop()
    }
  })

  test('is left alone when the agent took it and works, or when it started long ago', async () => {
    const a = agents()
    a.submitMs = 10
    const prompt = spyOn(herdr, 'prompt').mockResolvedValue(undefined as never)
    const keys = spyOn(herdr, 'paneKeys').mockResolvedValue(undefined as never)
    try {
      a.live.set('shep-t-1', listed({ name: 'shep-t-1', agent_status: 'working' }))
      await put(a, 'Do the work.')
      await Bun.sleep(60)
      a.live.set('shep-t-1', listed({ name: 'shep-t-1' }))
      a.records[key].started = Date.now() - 600_000
      await put(a, 'A later message.')
      await Bun.sleep(60)
      expect(keys).not.toHaveBeenCalled()
    } finally {
      prompt.mockRestore()
      keys.mockRestore()
      a.stop()
    }
  })

  test('a slow-starting agent gets the text once, only when ready, and its Enter again if the turn does not start', async () => {
    const a = agents()
    a.submitMs = 200
    a.live.set('shep-t-1', listed({ name: 'shep-t-1', interactive_ready: false }))
    const prompt = spyOn(herdr, 'prompt').mockImplementation((async () => {
      // pasted while not ready: lost
      if (a.info(key)?.interactive_ready === false) throw new Error('pasted too early')
    }) as never)
    setTimeout(() => a.live.set('shep-t-1', listed({ name: 'shep-t-1', interactive_ready: true })), 250)
    // the first Enter is lost while the CLI starts; the agent works only after the second
    const keys = spyOn(herdr, 'paneKeys').mockImplementation((async () => {
      a.live.set('shep-t-1', listed({ name: 'shep-t-1', agent_status: 'working' }))
    }) as never)
    try {
      await put(a, 'Do the work.')
      // a loaded machine delays the timers: wait for the second Enter instead of a fixed time
      for (let i = 0; i < 40 && keys.mock.calls.length === 0; i++) await Bun.sleep(100)
      expect(prompt).toHaveBeenCalledTimes(1)
      expect(keys).toHaveBeenCalledTimes(1)
      expect(a.status(key)).toBe('working')
    } finally {
      prompt.mockRestore()
      keys.mockRestore()
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
