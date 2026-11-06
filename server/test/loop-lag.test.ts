// The server measures its event loop: a block over 200 ms is logged with the work that held it.
import { afterAll, describe, expect, test } from 'bun:test'
import { startApp } from '../server/app.ts'
import { held, stopLoopLag } from '../server/live/loop-lag.ts'
import { Emitter, type Source, type SourceEvents } from '../server/source.ts'

class Stub extends Emitter<SourceEvents> {
  kind = 'demo' as const
  snapshot() {
    return { name: 'x', host: 'h', places: [], tasks: [], automations: {}, artifacts: [], asks: {}, settings: [], user: 'u' }
  }
}

const lines: string[] = []
const app = startApp({ source: new Stub() as unknown as Source, port: 0, log: (l) => lines.push(l) })
const base = `http://127.0.0.1:${app.port}`
afterAll(() => {
  app.stop(true)
  stopLoopLag()
})

const block = (ms: number) => {
  const end = performance.now() + ms
  while (performance.now() < end);
}

describe('loop lag', () => {
  test('a 300 ms block inside a named job is logged once with its name', async () => {
    held('rule rebuild', () => block(300))
    await Bun.sleep(100)
    const mine = lines.filter((l) => l.includes('rule rebuild'))
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatch(/loop lag \d{3,} ms, held by rule rebuild/)
  })

  test('the lag figures come back from the server', async () => {
    const res = await fetch(`${base}/api/loop-lag?window=0.5`)
    const f = (await res.json()) as { p50: number; p95: number; max: number; cpu: number; samples: number }
    expect(f.samples).toBeGreaterThan(0)
    for (const k of ['p50', 'p95', 'max', 'cpu'] as const) expect(typeof f[k]).toBe('number')
    expect(f.max).toBeGreaterThanOrEqual(f.p95)
  })

  test('a profile of the server comes back', async () => {
    const p = (await (await fetch(`${base}/api/loop-profile?window=0.1`)).json()) as { nodes: unknown[] }
    expect(p.nodes.length).toBeGreaterThan(0)
  })
})
