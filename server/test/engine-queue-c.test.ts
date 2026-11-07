import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { repo, world, started, placeId, writeJson } from './engine-world.ts'

describe('pinning', () => {
  test('a pin is kept across restarts; unpinning drops it; an archived task drops it and is not pinned again', async () => {
    const w = world()
    const { t } = await started(w, repo(), 'pinned')
    w.engine.pin(t.id, true)
    expect(t.pinned).toBeNumber()
    expect(w.engine.view(t).pinned).toBe(t.pinned!)
    // read back as after a restart
    expect(world().engine.task(t.id)!.pinned).toBe(t.pinned!)
    w.engine.pin(t.id, false)
    expect(world().engine.task(t.id)!.pinned).toBeUndefined()
    w.engine.pin(t.id, true)
    await w.engine.archive(t.id)
    expect(t.pinned).toBeUndefined()
    expect(() => w.engine.pin(t.id, true)).toThrow(/archived/)
    // brought back, it is not pinned again on its own
    w.engine.unarchive(t.id)
    expect(t.pinned).toBeUndefined()
  })

  test('a Done task that archives itself drops its pin', () => {
    const now = Date.now()
    writeJson('tasks.json', {
      next: { OLD: 1 },
      tasks: [
        {
          id: 'OLD-1',
          n: 1,
          project: 'p:x:old',
          title: 'Old',
          desc: '',
          by: 'x',
          created: 1,
          updated: 1,
          merged: true,
          doneAt: now - 30 * 86_400_000,
          pinned: 5,
        },
      ],
    })
    const w = world()
    expect(w.engine.autoArchive(now)).toBe(1)
    expect(w.engine.task('OLD-1')!.pinned).toBeUndefined()
  })
})

describe('archiving', () => {
  test("a working task's agent stops first; it leaves every count, keeps its record, and nothing about it is news", async () => {
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'archwork')
    const wt = t.worktree!
    const before = { news: w.news.length, cards: w.cards.length }
    const r = await w.engine.archive(t.id)
    expect(r.stopped).toBe(true)
    expect(w.records[key].finished).toBe(true)
    // no work in it: its worktree went, as with task stop
    expect(existsSync(wt)).toBe(false)
    expect(t.archived).toBeNumber()
    w.engine.agentStatus(key)
    await Bun.sleep(50)
    expect(w.news.length).toBe(before.news)
    expect(w.cards.length).toBe(before.cards)
    expect(w.engine.count(placeId.space('archwork'), w.engine.statusOf(t))).toBe(0)
    const v = w.engine.view(t)
    expect(v.archived).toBe(t.archived!)
    expect(v.state).toStartWith('Archived')
    expect(w.engine.task(t.id)).toBe(t)
  })

  test('unarchive brings it back quietly; so does writing to it', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'archback')
    await w.engine.archive(t.id)
    const cards = w.cards.length
    w.engine.unarchive(t.id)
    expect(t.archived).toBeUndefined()
    expect(t.unarchived).toBeNumber()
    expect(w.cards.length).toBe(cards)
    await w.engine.archive(t.id)
    w.engine.youWrote(key)
    expect(t.archived).toBeUndefined()
    expect(w.engine.statusOf(t)).toBe('work')
  })

  test('Done tasks archive themselves after tasks.archiveAfter; off keeps them; a brought-back one waits again', () => {
    const w = world()
    const day = 86_400_000
    const now = Date.now()
    const done = (id: string, updated: number, more = {}) => ({
      id,
      n: 1,
      project: 'p:x',
      title: id,
      desc: '',
      by: 't',
      created: 1,
      updated,
      merged: true,
      cleaned: true,
      ...more,
    })
    const tasks = w.engine.tasks as unknown as ReturnType<typeof done>[]
    tasks.push(done('OLD-1', now - 8 * day), done('NEW-1', now - 2 * day), done('BACK-1', now - 30 * day, { unarchived: now - day }))
    tasks.push({ ...done('OPEN-1', now - 30 * day), merged: false } as never)
    // one whose agent you are talking to stays put
    tasks.push(done('BUSY-1', now - 30 * day))
    w.status['BUSY-1/Agent'] = 'working'
    // tasks earlier tests left in tasks.json are left out: only these five are looked at
    tasks.splice(0, tasks.length - 5)
    expect(w.engine.autoArchive(now)).toBe(1)
    expect(w.engine.task('OLD-1')!.archived).toBe(now)
    expect(w.engine.task('NEW-1')!.archived).toBeUndefined()
    expect(w.engine.task('BACK-1')!.archived).toBeUndefined()
    expect(w.engine.task('OPEN-1')!.archived).toBeUndefined()
    expect(w.engine.task('BUSY-1')!.archived).toBeUndefined()
    // writing to an archived Done task brings it back too
    w.engine.youWrote('OLD-1/Agent')
    expect(w.engine.task('OLD-1')!.archived).toBeUndefined()
    expect(w.settings.set('tasks.archiveAfter', '1 day').ok).toBe(true)
    expect(w.engine.autoArchive(now)).toBe(2)
    w.engine.unarchive('OLD-1')
    w.engine.unarchive('NEW-1')
    expect(w.settings.set('tasks.archiveAfter', 'off').ok).toBe(true)
    expect(w.engine.autoArchive(now + 99 * day)).toBe(0)
    expect(w.settings.set('tasks.archiveAfter', 'soon').ok).toBe(false)
    expect(w.settings.set('tasks.archiveAfter', '0 days').ok).toBe(false)
    expect(w.settings.set('tasks.archiveAfter', '10 days').ok).toBe(true)
    expect(w.settings.set('tasks.archiveAfter', '10').ok).toBe(true)
  })
})
