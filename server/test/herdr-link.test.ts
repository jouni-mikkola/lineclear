// 45 panes starting and stopping never rebuild the held connection, and the session is read at most once.
import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { listAfter } from '../server/live/agent-events.ts'
import { type AgentInfo, paneEvents, Subscription } from '../server/live/herdr.ts'

test('45 panes start and stop with 0 reopens and at most 1 snapshot', async () => {
  let sockets = 0
  let heldAsked = 0
  const asked: string[] = []
  let reads = 0
  const sub = new Subscription(
    () => undefined,
    (planned) => {
      if (!planned) reads++
    },
    () => {
      sockets++
      const socket = Object.assign(new EventEmitter(), {
        write(s: string) {
          const subs = JSON.parse(s).params.subscriptions as { pane_id?: string }[]
          if (subs.some((x) => !x.pane_id)) heldAsked++
          asked.push(...subs.map((x) => x.pane_id ?? 'all'))
          queueMicrotask(() => socket.emit('data', Buffer.from(`${JSON.stringify({ result: {} })}\n`)))
        },
        destroy() {
          socket.emit('close')
        },
      })
      queueMicrotask(() => socket.emit('connect'))
      return socket
    },
  )
  let listed: AgentInfo[] = []
  let snapshots = 0
  const hear = (event: string, data: Record<string, unknown>) => {
    const next = listAfter(listed, { event, data })
    if (next === 'read') snapshots++
    else if (next) listed = next
  }
  try {
    sub.set(paneEvents([]))
    await Bun.sleep(20)
    snapshots++
    for (let i = 0; i < 45; i++) {
      const pane = { pane_id: `w1:p${i}`, tab_id: 'w1:t1', workspace_id: 'w1', agent: 'pi' }
      hear('pane_created', pane)
      hear('pane_agent_detected', pane)
      sub.set(paneEvents(listed.map((a) => a.pane_id)))
    }
    await Bun.sleep(20)
    for (let i = 0; i < 45; i++) {
      hear('pane_exited', { pane_id: `w1:p${i}` })
      sub.set(paneEvents(listed.map((a) => a.pane_id)))
    }
    await Bun.sleep(20)
    expect(heldAsked).toBe(1)
    expect(sockets).toBe(46)
    expect(reads).toBe(0)
    expect(snapshots).toBe(1)
    expect(asked.filter((x) => x.startsWith('w1:p')).length).toBe(45)
    expect(listed).toEqual([])
  } finally {
    sub.stop()
  }
})
