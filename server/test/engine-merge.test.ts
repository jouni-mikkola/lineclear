import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sh, repo, world, until, started } from './engine-world.ts'
import { seedModels } from './model-fixture.ts'

seedModels()

/** its worktree stays while its turn runs, and goes once the turn ends */
async function cleanedAfterTurn(w: ReturnType<typeof world>, t: Awaited<ReturnType<typeof started>>['t'], key: string) {
  expect(existsSync(t.worktree!)).toBe(true)
  w.agentIs(key, 'idle')
  await until(() => !!t.cleaned)
  expect(existsSync(t.worktree!)).toBe(false)
}

describe('lineclear merge', () => {
  test('rebases on main, squash-merges into main, marks it merged and cleans up once the turn ends', async () => {
    const begun = Date.now()
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'merges')
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    sh('git add -A && git commit -qm "add hello"', t.worktree!)
    // main moved on since the task started
    writeFileSync(join(dir, 'other.txt'), 'other\n')
    sh('git add -A && git commit -qm other', dir)
    await w.engine.done(t.id, 'Added hello.txt.')
    // the agent itself merges, mid-turn
    const r = await w.engine.merge(t.id, { self: true })
    expect(r).toEqual({ ok: true, note: undefined })
    expect(sh('git log --format=%s -n 3', dir).split('\n')).toEqual([`${t.id}: Say hello`, 'other', 'init'])
    expect(sh('git log -1 --format=%b', dir)).toBe('Added hello.txt.')
    expect(existsSync(join(dir, 'hello.txt'))).toBe(true)
    // its squash commit is recorded: what its branch is checked against when it is put away
    expect(t.squash).toBe(sh('git rev-parse main', dir))
    expect(w.engine.statusOf(t)).toBe('done')
    expect(w.engine.view(t).agent?.status).toBe('done')
    // its row says a few words; the summary is its card's
    expect(w.engine.subOf(t)).toBe('Merged')
    expect(w.engine.view(t).said).toBe('Added hello.txt.')
    // it keeps when it finished: the Done group's order and the row's age
    expect(t.doneAt).toBeGreaterThanOrEqual(begun)
    expect(t.doneAt).toBeLessThanOrEqual(Date.now())
    expect(w.engine.view(t)).toMatchObject({ doneAt: t.doneAt, age: 'now' })
    await cleanedAfterTurn(w, t, key)
    expect(w.records[key].finished).toBe(true)
    expect(sh('git branch --list "work/*"', dir)).toBe('')
    expect(w.news).toContain(`${t.id} was merged`)
    expect(await w.engine.merge(t.id)).toEqual({ ok: true, note: `${t.id} is merged already` })
    // one Done card for its project's chat, however often it settles again
    w.agentIs(key, 'idle')
    expect(w.cards.filter((c) => c.status === 'done')).toEqual([{ task: t.id, status: 'done', sub: 'Merged' }])
  })

  test('merged by you while its agent waits: cleaned up at once', async () => {
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'byyou')
    writeFileSync(join(t.worktree!, 'x.txt'), 'x\n')
    // left uncommitted: the merge commits it
    w.agentIs(key, 'idle')
    expect((await w.engine.merge(t.id)).ok).toBe(true)
    expect(existsSync(join(dir, 'x.txt'))).toBe(true)
    expect(existsSync(t.worktree!)).toBe(false)
  })

  test('a conflict with main stops it with what to do, and main stays as it was', async () => {
    const w = world()
    const dir = repo()
    const { t } = await started(w, dir, 'conflicts')
    writeFileSync(join(t.worktree!, 'README.md'), 'theirs\n')
    sh('git commit -qam theirs', t.worktree!)
    writeFileSync(join(dir, 'README.md'), 'mine\n')
    sh('git commit -qam mine', dir)
    const before = sh('git rev-parse HEAD', dir)
    const r = await w.engine.merge(t.id, { self: true })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Conflict with main')
    expect(r.error).toContain(`lineclear merge ${t.id} again`)
    expect(sh('git rev-parse HEAD', dir)).toBe(before)
    expect(sh('git status --porcelain', t.worktree!)).toBe('')
    expect(t.merged).toBeFalsy()
  })

  test('a late message it has not read yet stops the merge until it has', async () => {
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'late')
    writeFileSync(join(t.worktree!, 'late.txt'), 'late\n')
    sh('git add -A && git commit -qm late', t.worktree!)
    // you wrote while it finished; it hasn't taken your words in yet
    w.chat.unseen = ['Also rename the button']
    const r = await w.engine.merge(t.id, { self: true })
    expect(r).toEqual({ ok: false, error: 'You have a new message in your chat: read and handle it, then merge again.' })
    expect(existsSync(join(dir, 'late.txt'))).toBe(false)
    expect(t.merged).toBeFalsy()
    w.agentIs(key, 'idle')
    expect((await w.engine.merge(t.id)).error).toBe(`${t.id}'s agent has a new message it hasn't read yet: let it handle that first.`)
    // it read it: the merge goes in
    w.chat.unseen = []
    expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
    expect(existsSync(join(dir, 'late.txt'))).toBe(true)
  })

  test('anyone else waits for the agent to end its turn: no half-done work goes in', async () => {
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'busy')
    writeFileSync(join(t.worktree!, 'half.txt'), 'half\n')
    const r = await w.engine.merge(t.id)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('is working')
    expect(existsSync(join(dir, 'half.txt'))).toBe(false)
    w.agentIs(key, 'idle')
    expect((await w.engine.merge(t.id)).ok).toBe(true)
  })

  test('two merges into one repo at once both go in, one after the other', async () => {
    const w = world()
    const dir = repo()
    const a = await started(w, dir, 'two', 'First', 'a')
    const b = w.engine.add({ project: a.p.name, title: 'Second', by: 'test' })
    await until(() => w.started.some((s) => s.key === `${b.id}/Agent`))
    writeFileSync(join(a.t.worktree!, 'a.txt'), 'a\n')
    writeFileSync(join(b.worktree!, 'b.txt'), 'b\n')
    const [ra, rb] = await Promise.all([w.engine.merge(a.t.id, { self: true }), w.engine.merge(b.id, { self: true })])
    expect([ra.ok, rb.ok]).toEqual([true, true])
    expect(existsSync(join(dir, 'a.txt')) && existsSync(join(dir, 'b.txt'))).toBe(true)
    expect(sh('git status --porcelain', dir)).toBe('')
  })

  test('with a remote, main here first catches up with it, so the merge sits on top of what is there', async () => {
    const w = world()
    const origin = repo()
    const dir = mkdtempSync(join(tmpdir(), 'shep-clone-'))
    sh(`git clone -q ${origin} . && git config user.email t@t && git config user.name T`, dir)
    const { t } = await started(w, dir, 'remote')
    // someone else's work lands on the remote; main here never pulled it
    writeFileSync(join(origin, 'theirs.txt'), 'theirs\n')
    sh('git add -A && git commit -qm theirs', origin)
    writeFileSync(join(t.worktree!, 'mine.txt'), 'mine\n')
    w.agentIs(`${t.id}/Agent`, 'idle')
    expect((await w.engine.merge(t.id)).ok).toBe(true)
    expect(sh('git log --format=%s -n 3', dir).split('\n')).toEqual([`${t.id}: Say hello`, 'theirs', 'init'])
    // the task's commit holds only its own change
    expect(sh('git show --name-only --format= HEAD', dir)).toBe('mine.txt')
  })

  test('a branch already merged by hand is only marked merged', async () => {
    const w = world()
    const dir = repo()
    const { t } = await started(w, dir, 'byhand')
    writeFileSync(join(t.worktree!, 'y.txt'), 'y\n')
    sh('git add -A && git commit -qm y', t.worktree!)
    sh(`git merge -q --squash ${t.branch} && git commit -qm "by hand"`, dir)
    const r = await w.engine.merge(t.id, { self: true })
    expect(r).toEqual({ ok: true, note: 'it was in main already' })
    expect(sh('git log --format=%s -n 1', dir)).toBe('by hand')
    expect(w.engine.statusOf(t)).toBe('done')
  })

  for (const how of ['squashed', 'with a merge commit'])
    test(`its pull request merged on GitHub ${how}, and main moved on since: only marked merged`, async () => {
      const w = world()
      const dir = repo()
      const { t } = await started(w, dir, `pr-${how.split(' ').at(-1)}`)
      // two commits, the second changing the first (a review fix)
      writeFileSync(join(t.worktree!, 'p.txt'), 'p\n')
      sh('git add -A && git commit -qm p', t.worktree!)
      writeFileSync(join(t.worktree!, 'p.txt'), 'p, fixed\n')
      sh('git add -A && git commit -qm fix', t.worktree!)
      sh(how === 'squashed' ? `git merge -q --squash ${t.branch} && git commit -qm "PR #1"` : `git merge -q --no-ff -m "PR #1" ${t.branch}`, dir)
      writeFileSync(join(dir, 'later.txt'), 'later\n')
      sh('git add -A && git commit -qm later', dir)
      const r = await w.engine.merge(t.id, { self: true })
      expect(r).toEqual({ ok: true, note: 'it was in main already' })
      expect(sh('git log --format=%s -n 2', dir).split('\n')).toEqual(['later', 'PR #1'])
      expect(w.engine.statusOf(t)).toBe('done')
    })

  test('nothing to merge is refused', async () => {
    const w = world()
    const { t } = await started(w, repo(), 'empty')
    const r = await w.engine.merge(t.id, { self: true })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('no changes')
  })
})

describe('closed with nothing to merge', () => {
  const branches = (dir: string) => sh('git branch --list "work/*" --format="%(refname:short)"', dir)

  test('done on a branch with no changes goes straight to Done, closed, and is put away once its turn ends', async () => {
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'answer', 'Answer a question', 'Find out why. Report done.')
    expect(await w.engine.done(t.id, 'It is the clock.')).toBe('closed')
    expect(t.closed).toBe(true)
    expect(t.merged).toBeFalsy()
    expect(w.engine.statusOf(t)).toBe('done')
    expect(w.engine.subOf(t)).toBe('Nothing to merge')
    expect(w.engine.view(t).said).toBe('It is the clock.')
    expect(w.engine.view(t).state).toStartWith('Done · nothing to merge')
    expect(w.news).toContain(`${t.id} is done, nothing to merge: It is the clock.`)
    await cleanedAfterTurn(w, t, key)
    expect(branches(dir)).toBe('')
    expect(w.records[key].finished).toBe(true)
    w.agentIs(key, 'idle')
    expect(w.cards.filter((c) => c.status === 'done')).toEqual([{ task: t.id, status: 'done', sub: 'Nothing to merge' }])
    expect(sh('git log --format=%s', dir)).toBe('init')
    const r = await w.engine.merge(t.id, { self: true })
    expect(r.error).toContain('it had nothing to merge')
    expect(await w.engine.done(t.id, 'again')).toBe('ended')
    expect(() => w.engine.todo(t.id)).toThrow('Done already (nothing to merge)')
  })

  test('done with changes, committed or not, is Ready as before', async () => {
    const w = world()
    const { t } = await started(w, repo(), 'readyagain')
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    expect(await w.engine.done(t.id, 'Added hello.txt.')).toBe('ready')
    sh('git add -A && git commit -qm hello', t.worktree!)
    expect(await w.engine.done(t.id, 'Added hello.txt.')).toBe('ready')
    expect(t.closed).toBeFalsy()
  })

  test('task close stops its agent, puts its worktree and branch away and marks it Done, Nothing to merge by default', async () => {
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'closes')
    // its agent is at work
    expect(await w.engine.close(t.id)).toEqual({ kept: [] })
    expect(w.records[key].finished).toBe(true)
    expect(w.engine.statusOf(t)).toBe('done')
    expect(w.engine.subOf(t)).toBe('Nothing to merge')
    // closed is when it finished, as merged is
    expect(w.engine.view(t)).toMatchObject({ doneAt: t.doneAt, age: 'now' })
    expect(existsSync(t.worktree!)).toBe(false)
    expect(branches(dir)).toBe('')
    expect(w.herdr.spaces.some((x) => x.label === `${t.id} Say hello`)).toBe(false)
    expect(w.news.some((n) => n.startsWith(`${t.id} is done, nothing to merge`))).toBe(true)
    expect(w.cards.filter((c) => c.status === 'done')).toEqual([{ task: t.id, status: 'done', sub: 'Nothing to merge' }])
    await expect(w.engine.close(t.id)).rejects.toThrow('Done already (nothing to merge)')
  })

  test('task close keeps unmerged work in its branch and says so; the folder goes; the sweep leaves the branch be', async () => {
    const w = world()
    const dir = repo()
    const { t } = await started(w, dir, 'closekeeps')
    writeFileSync(join(t.worktree!, 'wip.txt'), 'wip\n')
    sh('git add -A && git commit -qm wip', t.worktree!)
    const { kept } = await w.engine.close(t.id, 'Not needed any more.', undefined, true)
    expect(kept).toEqual([`branch ${t.branch} (work on ${t.branch} that main lacks)`])
    expect(w.engine.view(t).said).toBe('Not needed any more.')
    expect([existsSync(t.worktree!), sh(`git show ${t.branch}:wip.txt`, dir)]).toEqual([false, 'wip'])
    expect(branches(dir)).toBe(t.branch!)
    expect(w.engine.keptLeftovers()[0]).toStartWith(`${t.id} `)
    await w.engine.sweep()
    expect(branches(dir)).toBe(t.branch!)
  })

  test('a Ready task closed without a summary keeps what it said when done', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'closeready')
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    expect(await w.engine.done(t.id, 'Drafted it; not wanted after all.')).toBe('ready')
    w.agentIs(key, 'idle')
    const { kept } = await w.engine.close(t.id)
    expect(kept[0]).toEndWith('(uncommitted changes)')
    expect(w.engine.view(t).said).toBe('Drafted it; not wanted after all.')
  })

  test('a stopped task stuck in To do, its worktree already gone, closes', async () => {
    const w = world()
    const dir = repo()
    const { t } = await started(w, dir, 'stuck', 'Look into it', "Don't start yet, wait for a go.")
    w.engine.todo(t.id)
    await w.engine.stopTask(t.id)
    expect(w.engine.statusOf(t)).toBe('todo')
    expect(await w.engine.close(t.id, 'Answered elsewhere.')).toEqual({ kept: [] })
    expect(w.engine.statusOf(t)).toBe('done')
    expect(t.cleaned).toBe(true)
  })
})

describe('an agent ends at ready', () => {
  test('its process ends once its turn does, and the board merges the branch', async () => {
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'ends-at-ready')
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    sh('git add -A && git commit -qm "add hello"', t.worktree!)
    await w.engine.done(t.id, 'Added hello.txt.')
    expect(w.engine.landAtReady(t.id)).toBe(true)
    w.agentIs(key, 'idle')
    await until(() => !!t.merged)
    expect(w.agents.record(key)?.finished).toBe(true)
    expect(existsSync(join(dir, 'hello.txt'))).toBe(true)
  })

  test('is left to the human when merges ask first', async () => {
    const w = world()
    const { t } = await started(w, repo(), 'asks-first')
    w.settings.set('brief.merge', 'ask me first')
    try {
      expect(w.engine.landAtReady(t.id)).toBe(false)
    } finally {
      w.settings.set('brief.merge', null)
    }
  })
})
