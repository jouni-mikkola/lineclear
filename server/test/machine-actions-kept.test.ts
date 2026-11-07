import { expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import type { Action } from '../shared/types.ts'
import { MachinesActions } from '../server/live/machines-actions.ts'
import { machineHome } from '../server/live/machines-helpers.ts'
import { until } from './until.ts'

const saved = { label: 'kept-queue-w', target: 'x', enabled: true }
type Inside = { link(m: typeof saved): import('../server/live/machines-helpers.ts').Link; poll(l: unknown): Promise<void> }

test('actions for a machine out of reach survive a restart and arrive once', async () => {
  rmSync(machineHome(saved.label), { recursive: true, force: true })
  const got: string[] = []
  const snapshot = { places: [], tasks: [], machines: [{ status: 'ok' }] }
  const worker = Bun.serve({
    port: 0,
    fetch(req, srv) {
      const p = new URL(req.url).pathname
      if (p === '/api/ws') return srv.upgrade(req) ? undefined : new Response('no', { status: 400 })
      if (p === '/api/snapshot') return Response.json(snapshot)
      return req.json().then((a: Action & { text: string }) => (got.push(a.text), Response.json({ ok: true })))
    },
    websocket: { message() {} },
  })
  const url = `http://127.0.0.1:${worker.port}`
  const first = new MachinesActions(null)
  const l1 = (first as unknown as Inside).link(saved)
  for (const text of ['a', 'b', 'c']) expect(await first.act(l1, { type: 'send', chat: 'm:kept-queue-w:x', text } as Action)).toEqual({ waiting: true })
  first.stop()

  const second = new MachinesActions(null)
  const l2 = (second as unknown as Inside).link(saved)
  expect(l2.waiting.map((q) => (q.action as { text: string }).text)).toEqual(['a', 'b', 'c'])
  expect(new Set(l2.waiting.map((q) => q.id)).size).toBe(3)
  l2.rec.url = url
  await (second as unknown as Inside).poll(l2)
  await until(() => got.length === 3)
  second.stop()
  worker.stop(true)
  expect(got).toEqual(['a', 'b', 'c'])
  expect(l2.waiting).toEqual([])

  const third = new MachinesActions(null)
  expect((third as unknown as Inside).link(saved).waiting).toEqual([])
  third.stop()
  rmSync(machineHome(saved.label), { recursive: true, force: true })
})
