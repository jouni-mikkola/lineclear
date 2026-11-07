import { expect, test } from 'bun:test'
import { Machines } from '../server/live/machines.ts'
import type { Snapshot } from '../shared/types.ts'
import { until } from './until.ts'

type Inner = {
  stale: Set<unknown>
  stepUpdates(): void
  start(l: unknown): Promise<void>
}

const snap = (status: string) => ({ tasks: [{ status }] }) as unknown as Snapshot

test('workers on older code update one at a time, the one with a working task last, and a failed read keeps them', async () => {
  let reads = 0
  const list = null
  const m = new Machines(
    async () => (reads++, list),
    async () => ({}),
  )
  const inner = m as unknown as Inner
  const log: string[] = []
  let running = 0
  let most = 0
  const links = ['a', 'busy', 'c'].map((name) => {
    const l = m.adopt(name, 'http://127.0.0.1:1')
    l.snap = snap(name === 'busy' ? 'work' : 'done')
    l.worker = {
      pid: 0,
      kill: () => {
        log.push(name)
        running++
        most = Math.max(most, running)
      },
      get exited() {
        return Bun.sleep(20).then(() => {
          l.worker = undefined
          running--
        })
      },
    }
    inner.stale.add(l)
    return l
  })
  inner.start = async (l) => {
    log.push(`start ${(l as { rec: { machine: string } }).rec.machine}`)
  }
  try {
    inner.stepUpdates()
    await until(() => log.includes('start c'), 'the second update')
    expect(log).toEqual(['a', 'start a', 'c', 'start c'])
    expect(most).toBe(1)
    // the busy one goes once its task is done
    links[1].snap = snap('done')
    inner.stepUpdates()
    await until(() => log.includes('start busy'), 'the busy one to update')
    expect(log.slice(4)).toEqual(['busy', 'start busy'])
    expect(most).toBe(1)

    // a failed read of herdr's list keeps every worker
    for (const l of links) l.worker = { pid: 0, kill: () => log.push('removed'), exited: Promise.resolve() }
    await m.sync()
    expect(log).not.toContain('removed')
    expect(m.list()).toHaveLength(3)
    // one read at the start, one for the sync above; the 15 s ticks read nothing
    expect(reads).toBe(2)
  } finally {
    m.stop()
  }
})
