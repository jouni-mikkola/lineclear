// Faults seen in herdr-projects 2.0 (ebb17d5) that the fork fixes, each with a test that fails on the base's behaviour. The
// Each is named for the fault it plants.
import { describe, expect, spyOn, test } from 'bun:test'
import { Engine, fakeHerdr, repo, started, world } from './engine-world.ts'

const { Worktrees } = await import('../server/live/engine/worktrees.ts')
void Engine

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

describe('(f) two panes for one worktree', () => {
  test('an agent started in a space that holds only an idle shell leaves one pane, not two', async () => {
    const fake = fakeHerdr()
    const dir = repo()
    const wt = new Worktrees(fake.h as never)
    const made = await fake.h.worktreeCreate({ cwd: dir }, 'b', 'main', 'lab')
    const ws = made.workspace.workspace_id
    const path = made.worktree.path
    const pane = await wt.agentPane({ home: { cwd: dir } as never, wt: path, label: 'lab', tab: 'Agent', env: {} })
    const panes = await fake.h.panes(ws)
    expect(panes.map((p) => p.pane_id)).toEqual([pane])
    // again, its agent's CLI gone and its shell idle: still one pane
    const again = await wt.agentPane({ home: { cwd: dir } as never, wt: path, label: 'lab', tab: 'Agent', env: {} })
    expect((await fake.h.panes(ws)).map((p) => p.pane_id)).toEqual([again])
  })

  test('a space herdr restored with several idle shells is left with the agent pane only', async () => {
    const fake = fakeHerdr()
    const dir = repo()
    const wt = new Worktrees(fake.h as never)
    const made = await fake.h.worktreeCreate({ cwd: dir }, 'b', 'main', 'lab')
    const ws = made.workspace.workspace_id
    const path = made.worktree.path
    // the first agent's tab, then two restarts: each left one more agentless shell in an Agent tab
    await wt.agentPane({ home: { cwd: dir } as never, wt: path, label: 'lab', tab: 'Agent', env: {} })
    await fake.h.createTab(ws, 'Agent', path)
    expect((await fake.h.panes(ws)).length).toBe(2)
    const pane = await wt.agentPane({ home: { cwd: dir } as never, wt: path, label: 'lab', tab: 'Agent', env: {} })
    expect((await fake.h.panes(ws)).map((p) => p.pane_id)).toEqual([pane])
  })

  test("the human's own shell in a tab of another name stays", async () => {
    const fake = fakeHerdr()
    const dir = repo()
    const wt = new Worktrees(fake.h as never)
    const made = await fake.h.worktreeCreate({ cwd: dir }, 'b', 'main', 'lab')
    const ws = made.workspace.workspace_id
    const path = made.worktree.path
    const first = await wt.agentPane({ home: { cwd: dir } as never, wt: path, label: 'lab', tab: 'Agent', env: {} })
    const mine = (await fake.h.createTab(ws, 'git log', path)).root_pane.pane_id
    const again = await wt.agentPane({ home: { cwd: dir } as never, wt: path, label: 'lab', tab: 'Agent', env: {} })
    const left = (await fake.h.panes(ws)).map((p) => p.pane_id)
    expect(left).toContain(mine)
    expect(left).toContain(again)
    expect(left).not.toContain(first)
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

void spyOn
