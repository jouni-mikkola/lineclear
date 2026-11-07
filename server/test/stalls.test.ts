import { STALL_QUIET, SILENT_NEED } from './engine-fixture.ts'
import { describe, expect, test } from 'bun:test'
import { repo, world, started } from './engine-world.ts'

describe('EngineStalls', () => {
  test('SHE-193: a working task that goes quiet, or runs far past its time left, is stalled news: once per stall', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'stalls')
    w.agentIs(key, 'working')
    w.engine.report(t.id, 'Running the tests', 40, 10)
    const stalled = () => w.news.filter((n) => n.includes('may have stalled'))
    const later = (min: number) => Date.now() + min * 60_000
    w.engine.checkStalls(later(STALL_QUIET / 60_000 - 1))
    expect(stalled()).toEqual([])
    // quiet too long: what Lineclear saw, once
    w.engine.checkStalls(later(STALL_QUIET / 60_000 + 1))
    expect(stalled().length).toBe(1)
    expect(stalled()[0]).toContain(`${t.id} may have stalled: its agent shows as working, but nothing has changed for 21m`)
    expect(stalled()[0]).toContain('Its last status: "Running the tests", 40% done, 21m ago')
    expect(stalled()[0]).toContain('herdr sees no agent CLI running in its pane')
    // and a one-line card in its project's chat
    expect(w.cards.filter((c) => c.status === 'work')).toEqual([{ task: t.id, status: 'work', sub: 'may be stuck: quiet for 21m' }])
    w.engine.checkStalls(later(STALL_QUIET / 60_000 + 30))
    expect(stalled().length).toBe(1)
    // it shows life again (a tool call beat): the next stall is news again
    w.engine.alive(t.id, later(40))
    w.engine.checkStalls(later(45))
    expect(stalled().length).toBe(1)
    w.engine.checkStalls(later(40 + STALL_QUIET / 60_000 + 1))
    expect(stalled().length).toBe(2)
    // never while it waits on you
    w.agentIs(key, 'idle')
    w.engine.checkStalls(later(500))
    expect(stalled().length).toBe(2)
  })

  test('SHE-193: busy all along but far past its own time left is stalled news too', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'overdue')
    w.agentIs(key, 'working')
    w.engine.report(t.id, 'Building', 50, 10)
    const stalled = () => w.news.filter((n) => n.includes('may have stalled'))
    // a sign of life every minute: never quiet
    const busy = (min: number) => {
      w.engine.alive(t.id, Date.now() + min * 60_000)
      w.engine.checkStalls(Date.now() + min * 60_000)
    }
    busy(29)
    expect(stalled()).toEqual([])
    busy(31)
    expect(stalled()).toEqual([
      `${t.id} may have stalled: it has worked 31m since its agent said 10m were left. Its last status: "Building", 50% done, 31m ago; herdr sees no agent CLI running in its pane. Nudge it (lineclear task tell ${t.id} "…"), stop it, or tell the human`,
    ])
    expect(w.cards.filter((c) => c.status === 'work').map((c) => c.sub)).toEqual(['may be stuck: 21m past its time left'])
    busy(60)
    expect(stalled().length).toBe(1)
  })

  test('L257: one tool call that runs 25 minutes, beating every 5, is no stall; an agent that stopped mid-call is, after 20', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'longcall')
    w.agentIs(key, 'working')
    const later = (min: number) => Date.now() + min * 60_000
    const quietCards = () => w.cards.filter((c) => c.sub?.startsWith('may be stuck: quiet for'))
    for (const min of [5, 10, 15, 20, 25]) {
      w.engine.alive(t.id, later(min))
      w.engine.checkStalls(later(min))
    }
    expect(quietCards()).toEqual([])
    // the beats stop (the process died mid-call): quiet for 20 minutes from the last one
    w.engine.checkStalls(later(25 + STALL_QUIET / 60_000 - 1))
    expect(quietCards()).toEqual([])
    w.engine.checkStalls(later(25 + STALL_QUIET / 60_000 + 1))
    expect(quietCards().map((c) => c.sub)).toEqual(['may be stuck: quiet for 21m'])
  })

  test('L142: Needs you with no question is a stall: a card after 5 minutes and another each 5 more', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'silent')
    w.chat.reply = 'Done for now.'
    w.agentIs(key, 'idle')
    // no question: not Needs you, the stall cards below nudge and restart it
    expect(w.engine.statusOf(t)).toBe('work')
    const stuck = () => w.cards.filter((c) => c.task === t.id && c.sub.startsWith('may be stuck'))
    const at = (min: number) => Date.now() + min * 60_000
    w.engine.checkStalls(at(SILENT_NEED / 60_000 - 1))
    expect(stuck()).toEqual([])
    w.engine.checkStalls(at(6))
    expect(stuck().length).toBe(1)
    w.engine.checkStalls(at(8))
    expect(stuck().length).toBe(1)
    w.engine.checkStalls(at(12))
    expect(stuck().length).toBe(2)
  })

  test('L142: Needs you with a question, a plan or a login never gets a stall card', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'asked')
    w.agentIs(key, 'idle')
    w.chat.question = true
    w.engine.checkStalls(Date.now() + 60 * 60_000)
    w.chat.question = false
    w.chat.card = { id: 'c' } as never
    w.engine.checkStalls(Date.now() + 60 * 60_000)
    w.chat.card = undefined
    w.agentIs(key, 'blocked')
    expect(w.engine.statusOf(t)).toBe('need')
    w.engine.checkStalls(Date.now() + 60 * 60_000)
    expect(w.cards.filter((c) => c.task === t.id && c.sub.startsWith('may be stuck'))).toEqual([])
  })
})
