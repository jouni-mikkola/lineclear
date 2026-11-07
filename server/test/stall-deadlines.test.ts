import { describe, expect, test } from 'bun:test'
import { repo, world, started } from './engine-world.ts'
import { STALL_QUIET, SILENT_NEED } from './engine-fixture.ts'

const READY = 20 * 60_000

/** a task in the state a deadline waits on; the clock runs to each deadline, as the engine's timer would */
async function setup(kind: 'stall' | 'silent' | 'ready') {
  const w = world()
  const { t, key } = await started(w, repo(), kind)
  if (kind === 'stall') w.agentIs(key, 'working')
  else {
    w.chat.reply = 'Done for now.'
    w.agentIs(key, 'idle')
  }
  if (kind === 'ready') {
    Object.assign(t, { reported: true, reportedAt: Date.now() })
    // the grace after a message to the agent is real time, which the fake clock skips
    ;(w.engine as unknown as { wrote: Map<string, number> }).wrote.clear()
  }
  const cards = () => w.cards.filter((c) => c.task === t.id && c.sub.startsWith('may be stuck'))
  const told = () => w.sent.filter((s) => s.key === key && s.text.includes('reported'))
  return { w, t, count: () => (kind === 'ready' ? told().length : cards().length) }
}

describe('stall deadlines', () => {
  for (const [kind, wait] of [
    ['stall', STALL_QUIET],
    ['silent', SILENT_NEED],
    ['ready', READY],
  ] as const) {
    test(`L523: the ${kind} deadline brings one card, none before and none twice`, async () => {
      const { w, t, count } = await setup(kind)
      const start = Math.max(t.updated, t.reportedAt ?? 0)
      let at = start
      // the fake clock jumps from deadline to deadline: a card shows at the one that is due, not before
      for (let i = 0; i < 30 && count() === 0; i++) {
        at = w.engine.nextStallDue()
        expect(w.engine.clock.armedFor).toBeLessThanOrEqual(at)
        w.engine.clock.tick(at - 1)
        expect(count()).toBe(0)
        w.engine.clock.tick(at)
      }
      expect(count()).toBe(1)
      expect(at).toBeGreaterThanOrEqual(start + wait)
      expect(at).toBeLessThan(start + wait + 5_000)
      w.engine.clock.tick(at + 1_000)
      w.engine.clock.tick(at + 60_000)
      expect(count()).toBe(1)
    })
  }

  test('L523: with 561 tasks and 45 working, nothing due means no status call', async () => {
    const w = world()
    const { t } = await started(w, repo(), 'many')
    const now = Date.now()
    const tasks = w.engine.tasks as unknown[]
    for (let i = 0; i < 560; i++) {
      const working = i < 44
      tasks.push({ ...t, id: `X-${i}`, n: 1000 + i, updated: now, ...(working ? {} : { merged: true }) })
    }
    let calls = 0
    const status = w.agents.status
    w.agents.status = (k: string) => (calls++, status(k))
    for (let min = 0; min < SILENT_NEED / 60_000; min++) w.engine.checkStalls(now + min * 60_000)
    expect(calls).toBe(0)
  })
})
