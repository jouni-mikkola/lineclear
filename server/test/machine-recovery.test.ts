import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LinkBackoff } from '../server/live/recovery.ts'
import { EventEmitter } from 'node:events'
import { Subscription } from '../server/live/herdr.ts'
import { Tunnel } from '../server/live/tunnel.ts'
import { Machines } from '../server/live/machines.ts'
import { until } from './until.ts'
import type { Snapshot } from '../shared/types/snapshot.ts'

describe('machine link recovery', () => {
  test('retry delay is bounded and only stable success resets it', () => {
    const b = new LinkBackoff()
    expect([b.fail(0), b.fail(1), b.fail(2), b.fail(3), b.fail(4), b.fail(5)]).toEqual([3000, 6000, 12000, 24000, 30000, 30000])
    b.success(10)
    expect(b.fail(20)).toBe(30000)
    b.success(30)
    expect(b.fail(60_030)).toBe(3000)
  })

  test('a tunnel retries failed setup once, never overlaps, and cancels pending retry', async () => {
    let attempts = 0,
      active = 0,
      max = 0
    let finish!: () => void
    const tunnel = new Tunnel(async (track, stopped) => {
      attempts++
      active++
      max = Math.max(max, active)
      try {
        if (attempts === 1) throw Error('Could not resolve hostname')
        await new Promise<void>((resolve) => {
          finish = resolve
          track({ exited: Promise.resolve(), kill: resolve })
          if (stopped()) resolve()
        })
      } finally {
        active--
      }
    })
    try {
      tunnel.start()
      tunnel.start()
      await until(() => attempts === 2)
      tunnel.start()
      expect(max).toBe(1)
      finish()
      await Bun.sleep(20)
      tunnel.stop()
      await Bun.sleep(6100)
      expect(attempts).toBe(2)
    } finally {
      tunnel.stop()
    }
  })

  test('subscription retries a failed lookup, ignores stale close events, and cancels on stop', async () => {
    let attempts = 0,
      opened = 0
    const sockets: (EventEmitter & { write(s: string): void; destroy(): void })[] = []
    const sub = new Subscription(
      () => undefined,
      () => {
        opened++
      },
      () => {
        attempts++
        if (attempts === 1) throw Error('name lookup failed')
        const socket = Object.assign(new EventEmitter(), {
          write() {
            queueMicrotask(() => socket.emit('data', Buffer.from(`${JSON.stringify({ result: {} })}\n`)))
          },
          destroy() {
            socket.emit('close')
          },
        })
        sockets.push(socket)
        queueMicrotask(() => socket.emit('connect'))
        return socket
      },
    )
    try {
      sub.set([{ type: 'pane.closed' }])
      await until(() => opened === 1)
      expect(attempts).toBe(2)
      sub.set([{ type: 'pane.created' }])
      await until(() => opened === 2)
      expect(attempts).toBe(3)
      sockets[0].emit('close')
      sockets[1].emit('error', Error('SSH gone'))
      sockets[1].emit('close')
      sub.stop()
      await Bun.sleep(6100)
      expect(attempts).toBe(3)
    } finally {
      sub.stop()
    }
  })

  test('shutdown during socket cleanup cannot open a new tunnel', async () => {
    let release!: () => void,
      opened = false
    const t = new Tunnel(async (track, stopped) => {
      await new Promise<void>((resolve) => {
        release = resolve
        track({ exited: Promise.resolve(), kill: resolve })
      })
      if (!stopped()) opened = true
    })
    t.start()
    t.stop()
    release()
    await Bun.sleep(10)
    expect(opened).toBe(false)
  })

  test('a worker is one socket: one snapshot fetch while idle, and a killed link comes back', async () => {
    let fetches = 0,
      opened = 0
    const open: { close(): void }[] = []
    const snap = { machines: [{ status: 'idle' }], tasks: [] } as unknown as Snapshot
    const s = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (req, server) => {
        if (new URL(req.url).pathname === '/api/ws') return server.upgrade(req) ? undefined : new Response('no', { status: 400 })
        fetches++
        return Response.json(snap)
      },
      websocket: {
        open(ws) {
          opened++
          open.push(ws)
          ws.send(JSON.stringify({ type: 'snapshot', snapshot: snap }))
        },
        message() {},
      },
    })
    const intervals: unknown[] = []
    const realInterval = globalThis.setInterval
    globalThis.setInterval = ((...a: Parameters<typeof setInterval>) => (intervals.push(a), realInterval(...a))) as typeof setInterval
    const m = new Machines(null, async () => ({}))
    const l = m.adopt('fake-socket', `http://127.0.0.1:${s.port}`)
    ;(m as unknown as { retryAfter: number }).retryAfter = 50
    try {
      await until(() => opened === 1 && l.reachable)
      await Bun.sleep(1200)
      expect(fetches).toBe(1)
      expect(intervals).toHaveLength(0)
      open[0].close()
      await until(() => opened === 2 && l.reachable)
      expect(fetches).toBe(2)
    } finally {
      globalThis.setInterval = realInterval
      m.stop()
      s.stop(true)
    }
  })

  test('removing a machine cancels cached writes and late probes cannot restore it', async () => {
    const { HOME } = await import('../server/store.ts')
    const m = new Machines(null, async () => ({}))
    const l = m.adopt('removed-fake', 'http://127.0.0.1:1')
    type TestLink = typeof l
    const internal = m as unknown as {
      saved: () => Promise<never[]>
      keep(l: TestLink): void
      keepTimers: Map<string, ReturnType<typeof setTimeout>>
    }
    internal.saved = async () => []
    try {
      internal.keep(l)
      expect(internal.keepTimers.has(l.saved.label)).toBe(true)
      await m.sync()
      expect(m.byName(l.saved.label)).toBeUndefined()
      expect(internal.keepTimers.has(l.saved.label)).toBe(false)
      internal.keep(l)
      expect(internal.keepTimers.has(l.saved.label)).toBe(false)
      expect(existsSync(join(HOME, 'machines', l.saved.label, 'last.json'))).toBe(false)
    } finally {
      m.stop()
    }
  })
})
