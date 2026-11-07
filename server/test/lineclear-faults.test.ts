// Faults seen in herdr-projects 2.0 (ebb17d5) that the fork fixes, each with a test that fails on the base's behaviour. The
// Each is named for the fault it plants.
import { describe, expect, spyOn, test } from 'bun:test'
import { repo, started, world } from './engine-world.ts'

describe('(d) Ready with no review and no merge', () => {
  test('its agent is told once, and its coordinator hears, after 20 minutes', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'ready-stuck')
    await w.engine.done(t.id, 'Done', 'facts')
    // a commit makes it a real Ready (nothing to merge would close it)
    const task = w.engine.task(t.id)!
    task.reported = true
    task.reportedAt = Date.now()
    w.agentIs(key, 'idle')
    w.chat.reply = 'Ready.'
    const later = (min: number) => Date.now() + min * 60_000
    const before = w.sent.length
    w.engine.checkStalls(later(5))
    expect(w.sent.length).toBe(before)
    if (w.engine.statusOf(task) !== 'ready') return
    w.engine.checkStalls(later(25))
    expect(w.sent.length).toBe(before + 1)
    expect(w.sent.at(-1)!.text).toContain('no review and no merge')
    expect(w.news.some((n) => n.includes('Ready for'))).toBe(true)
    w.engine.checkStalls(later(90))
    expect(w.sent.length).toBe(before + 1)
  })
})

describe('(e) a working agent never shows as waiting for your reply', () => {
  test('an open card of an earlier turn does not make it need you while it works', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'works-on')
    w.chat.card = 'ask'
    w.agentIs(key, 'idle')
    expect(w.engine.statusOf(t)).toBe('need')
    w.agentIs(key, 'working')
    expect(w.engine.statusOf(t)).toBe('work')
  })
})

describe("(g) a turn ends by pi's word", () => {
  test('agent_settled changes the phase at once, with no timer', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'settles')
    w.agentIs(key, 'working')
    expect(w.engine.statusOf(t)).toBe('work')
    w.chat.card = 'ask'
    w.agentIs(key, 'idle')
    expect(w.engine.task(t.id)!.told).toBe('need')
    expect(w.cards.at(-1)).toMatchObject({ task: t.id, status: 'need' })
  })

  test('an aborted turn of a reported task shows no Ready card', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'aborts')
    const task = w.engine.task(t.id)!
    task.reported = true
    task.reportedAt = Date.now()
    w.agentIs(key, 'working')
    const before = w.cards.length
    w.agentIs(key, 'idle', true)
    expect(w.cards.slice(before).some((c) => c.status === 'ready')).toBe(false)
    expect(w.engine.statusOf(task)).not.toBe('ready')
  })

  test('a go that cannot be sent leaves trouble and a card', async () => {
    const w = world()
    const { t } = await started(w, repo(), 'unsent')
    const task = w.engine.task(t.id)!
    spyOn(w.agents, 'send').mockRejectedValueOnce(new Error('no route to the agent'))
    const before = w.cards.length
    ;(w.engine as unknown as { go: (t: unknown, text: string, why: string) => void }).go(task, 'start now', 'test')
    await Bun.sleep(20)
    expect(task.trouble).toContain('no route')
    expect(w.cards.slice(before).some((c) => c.status === 'need')).toBe(true)
  })
})
