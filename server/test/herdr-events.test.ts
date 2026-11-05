// The server hears herdr's events: one subscription, the session read once when it opens and again after a lost or
// reopened one, and no pane read on a timer. A fake herdr socket counts the calls; a fake clock runs an idle hour.
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LINECLEAR_HOME = mkdtempSync(join(tmpdir(), 'shep-events-'))
process.env.HERDR_SOCKET_PATH = join(process.env.LINECLEAR_HOME, 'herdr.sock')
const { Agents } = await import('../server/live/agents.ts')
const { writeJson } = await import('../server/store.ts')

const panes = ['w1:p1', 'w2:p1', 'w3:p1', 'w4:p1', 'w5:p1']
const status = new Map(panes.map((p) => [p, 'idle']))
const calls: string[] = []
const subscribers: Socket[] = []
const agent = (pane_id: string) => ({
  agent: 'pi',
  agent_status: status.get(pane_id),
  name: `shep-t-${pane_id[1]}`,
  pane_id,
  tab_id: 't',
  workspace_id: pane_id.split(':')[0],
  cwd: null,
  interactive_ready: true,
})

const herdr = createServer((c) => {
  let buf = ''
  c.on('error', () => undefined)
  c.on('data', (d) => {
    buf += d
    const i = buf.indexOf('\n')
    if (i < 0) return
    const { id, method } = JSON.parse(buf.slice(0, i))
    buf = buf.slice(i + 1)
    calls.push(method)
    if (method === 'events.subscribe') {
      subscribers.push(c)
      c.write(`${JSON.stringify({ id, result: { subscribed: true } })}\n`)
      return
    }
    const result = method === 'session.snapshot' ? { snapshot: { agents: panes.map(agent) } } : {}
    c.end(`${JSON.stringify({ id, result })}\n`)
  })
}).listen(process.env.HERDR_SOCKET_PATH)
afterAll(() => herdr.close())

const count = (method: string) => calls.filter((m) => m === method).length
const real = { setTimeout, setInterval, clearTimeout, clearInterval, now: Date.now }
const settled = async (done: () => boolean) => {
  for (let i = 0; i < 1000 && !done(); i++) await new Promise((r) => real.setTimeout(r, 10))
  expect(done()).toBe(true)
}

/** time that moves only when the test says: timers fire in order as it passes */
function fakeClock() {
  let now = real.now()
  let id = 0
  const timers = new Map<number, { at: number; ms: number; run: () => void; every?: number }>()
  const add = (run: () => void, ms: number, every?: number) => {
    timers.set(++id, { at: now + ms, ms, run, every })
    return id as unknown as ReturnType<typeof setTimeout>
  }
  Object.assign(globalThis, {
    setTimeout: (run: () => void, ms = 0) => add(run, ms),
    setInterval: (run: () => void, ms = 0) => add(run, ms, ms),
    clearTimeout: (t: number) => timers.delete(t),
    clearInterval: (t: number) => timers.delete(t),
  })
  Date.now = () => now
  return {
    /** whether a timer of this length is set */
    has: (ms: number) => [...timers.values()].some((t) => t.ms === ms),
    async advance(ms: number) {
      const end = now + ms
      let fired = 0
      for (;;) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        const [key, t] = next
        now = t.at
        if (t.every) t.at += t.every
        else timers.delete(key)
        t.run()
        if (!t.every || ++fired % 100 === 0) await new Promise((r) => real.setTimeout(r, 0))
      }
      now = end
    },
    restore() {
      Object.assign(globalThis, {
        setTimeout: real.setTimeout,
        setInterval: real.setInterval,
        clearTimeout: real.clearTimeout,
        clearInterval: real.clearInterval,
      })
      Date.now = real.now
    },
  }
}

describe('an agents list kept by herdr events', () => {
  writeJson('agents.json', {})

  test('an idle hour with five agents: one subscription, one snapshot, no pane read; a lost one reads once more; a status shows', async () => {
    const clock = fakeClock()
    const a = new Agents()
    try {
      a.start()
      await settled(() => count('events.subscribe') === 1)
      // open once herdr's first answer is read: the handshake wait (15 s) is over
      await settled(() => !clock.has(15_000))
      expect(a.live.size).toBe(5)
      await clock.advance(60 * 60_000)
      expect(count('events.subscribe')).toBe(1)
      expect(count('session.snapshot')).toBe(1)
      expect(count('pane.read')).toBe(0)
      expect(count('pane.process_info')).toBe(0)
      expect(count('agent.list')).toBe(0)

      // herdr tells the status of a pane: the list changes with no read
      status.set('w2:p1', 'working')
      subscribers[0].write(
        `${JSON.stringify({ event: 'pane_agent_status_changed', data: { pane_id: 'w2:p1', workspace_id: 'w2', agent_status: 'working' } })}\n`,
      )
      await settled(() => a.live.get('shep-t-2')?.agent_status === 'working')
      expect(count('session.snapshot')).toBe(1)

      // herdr lost events: the subscription is opened again and the session is read once more
      subscribers[0].write(`${JSON.stringify({ id: 'sub-1', error: { code: 'events_lost', message: 'behind' } })}\n`)
      await settled(() => !a.reachable)
      await clock.advance(3000)
      await settled(() => count('events.subscribe') === 2 && count('session.snapshot') === 2 && !clock.has(15_000))
      // the snapshot is answered before the hour passes, or its own timeout fires
      await settled(() => a.reachable)
      await clock.advance(60 * 60_000)
      expect(count('events.subscribe')).toBe(2)
      expect(count('session.snapshot')).toBe(2)
      expect(count('pane.read') + count('pane.process_info')).toBe(0)
      expect(a.reachable).toBe(true)

      // the socket drops with no word: it is reopened and the session is read once more
      subscribers[subscribers.length - 1].end()
      await settled(() => !a.reachable)
      await clock.advance(3000)
      await settled(() => count('events.subscribe') === 3 && count('session.snapshot') === 3 && !clock.has(15_000))
      // the snapshot is answered before the hour passes, or its own timeout fires
      await settled(() => a.reachable)
      await clock.advance(60 * 60_000)
      expect(count('events.subscribe')).toBe(3)
      expect(count('session.snapshot')).toBe(3)
      expect(a.reachable).toBe(true)
    } finally {
      a.stop()
      clock.restore()
    }
  })
})
