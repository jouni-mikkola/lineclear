import { fitStatus, reportOf } from './engine-fixture.ts'
import { describe, expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sh, repo, world, started } from './engine-world.ts'
import { seedModels } from './model-fixture.ts'

seedModels()

describe("a task's own status line, % done and time left", () => {
  test('a status line longer than 40 characters is cut cleanly at a word', () => {
    expect(fitStatus('Fixing the two failing tests')).toBe('Fixing the two failing tests')
    expect(fitStatus('Fresh-eyes review running; awaiting plan approval for part 2')).toBe('Fresh-eyes review running; awaiting plan')
    // no dangling comma or "and" where it was cut
    expect(fitStatus('Updating file locations and running the checks')).toBe('Updating file locations and running')
    expect(fitStatus('Reading skill docs, searching old group names')).toBe('Reading skill docs, searching old group')
    expect(fitStatus('Moving the skills folder into the template and then')).toBe('Moving the skills folder')
    expect(fitStatus('Running checks for the whole workspace, and')).toBe('Running checks for the whole workspace')
    // one word too long for the line is cut where the line ends
    expect(fitStatus('x'.repeat(50))).toBe('x'.repeat(40))
    for (const t of ['a b c '.repeat(20), 'Rebasing onto main and rerunning all of the checks again']) expect(fitStatus(t).length).toBeLessThanOrEqual(40)
  })
  test('the minutes left count down while it works, stop while it waits on you, and nothing shows once its job is over', () => {
    const r = { msg: 'Fixing tests', progress: 40, left: 12, at: 0 }
    expect(reportOf(r, 'work', 0)).toEqual({ msg: 'Fixing tests', progress: 40, eta: 12, paused: undefined })
    expect(reportOf(r, 'work', 5 * 60_000)!.eta).toBe(7)
    expect(reportOf(r, 'work', 30 * 60_000)!.eta).toBe(0)
    expect(reportOf({ ...r, pausedAt: 5 * 60_000 }, 'need', 60 * 60_000)).toEqual({ msg: 'Fixing tests', progress: 40, eta: 7, paused: true })
    expect(reportOf({ ...r, left: undefined }, 'work', 0)!.eta).toBeUndefined()
    for (const s of ['ready', 'done', 'todo', 'queued'] as const) expect(reportOf(r, s, 0)).toBeUndefined()
    expect(reportOf(undefined, 'work')).toBeUndefined()
  })
})

describe('a turn the provider cut off', () => {
  type Retry = import('../server/live/retry.ts').Retry
  const cutOff = (w: ReturnType<typeof world>) => {
    const retries: Record<string, Retry | undefined> = {}
    w.engine.retry = (key) => retries[key]
    return retries
  }

  test('while it waits to try again it is still at work, saying why and when: no news, no card', async () => {
    const w = world()
    const retries = cutOff(w)
    const { t, key } = await started(w, repo(), 'retry-wait')
    retries[key] = { cut: 'e1', tries: 2, reason: 'Provider overloaded', words: 'Overloaded', due: Date.now() + 120_000 }
    w.agentIs(key, 'idle')
    await Bun.sleep(4100)
    expect(w.engine.view(t)).toMatchObject({ status: 'work', sub: 'Provider overloaded · retry in 2m' })
    expect(w.news.filter((n) => n.includes('needs you'))).toEqual([])
    // told to carry on: at work still while it takes that up
    retries[key] = { ...retries[key]!, due: undefined, nudged: Date.now() }
    expect(w.engine.statusOf(t)).toBe('work')
    // paused or stopped meanwhile: it is no longer told to, and shows so
    retries[key] = { ...retries[key]!, due: Date.now() + 60_000 }
    await w.engine.pause(t.id)
    expect(w.engine.mayRetry(key)).toBe(false)
    expect(w.engine.statusOf(t)).toBe('todo')
    w.engine.youWrote(key)
    expect(w.engine.mayRetry(key)).toBe(true)
    await w.engine.stopTask(t.id)
    expect(w.engine.mayRetry(key)).toBe(false)
  })

  test('reported done, a try still due does not make it Working', async () => {
    const w = world()
    const retries = cutOff(w)
    const { t, key } = await started(w, repo(), 'retry-ready')
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    await w.engine.done(t.id, 'Added hello.txt.')
    retries[key] = { cut: 'e1', tries: 1, reason: 'Provider overloaded', words: 'Overloaded', due: Date.now() + 60_000 }
    w.agentIs(key, 'idle')
    expect(w.engine.statusOf(t)).toBe('ready')
  })

  test('given up with no backup agent, it waits for you with the reason', async () => {
    const w = world()
    cutOff(w)
    w.settings.set('task.fallback', 'off')
    const { t, key } = await started(w, repo(), 'retry-over')
    w.engine.retry = () => ({ cut: 'e5', tries: 5, reason: 'Provider overloaded, still after 5 tries', words: 'Overloaded', over: true })
    w.agentIs(key, 'idle')
    await w.engine.cantGoOn(t.id, 'Provider overloaded, still after 5 tries')
    expect(w.engine.view(t)).toMatchObject({ status: 'need', sub: 'Provider overloaded, still after 5 tries' })
    expect(w.news).toContain(`${t.id} needs you: Provider overloaded, still after 5 tries`)
    expect(w.started.filter((s) => s.key === key)).toHaveLength(1)
    w.settings.set('task.fallback', null)
  })

  test('the backup agent takes over once, in the same worktree, with the brief and what was done so far', async () => {
    const w = world()
    cutOff(w)
    w.engine.installed = () => true
    const { t, key } = await started(w, repo(), 'retry-backup')
    sh('echo hi > hello.txt && git add -A && git commit -qm "Add hello.txt"', t.worktree!)
    writeFileSync(join(t.worktree!, 'more.txt'), 'more\n')
    w.chat.messages = [
      { who: 'you', text: 'Say hello\n\nAdd hello.txt. Merge when done.' },
      { who: 'agent', text: 'Added hello.txt; next the tests.' },
      { who: 'agent', card: {}, text: 'SHE-1 needs you' },
    ]
    w.agentIs(key, 'idle')
    await w.engine.cantGoOn(t.id, 'Out of allowance until 5pm')
    const s = w.started.filter((x) => x.key === key)
    expect(s).toHaveLength(2)
    expect(s[1]).toMatchObject({ kind: 'pi', model: 'default', cwd: t.worktree })
    expect(s[1].first).toStartWith('Say hello\n\nAdd hello.txt. Merge when done.')
    expect(s[1].first).toContain("Taking over: Claude Code worked on this task until now and can't go on (out of allowance until 5pm)")
    expect(s[1].first).toContain('Add hello.txt')
    expect(s[1].first).toContain('?? more.txt')
    expect(s[1].first).toContain('Claude Code: Added hello.txt; next the tests.')
    expect(s[1].first).not.toContain('needs you')
    expect(t.tookOver).toMatchObject({ from: 'claude', to: 'pi', why: 'out of allowance until 5pm' })
    expect(w.posted.some((p) => p.key === key && p.id.startsWith('takeover:'))).toBe(true)
    expect(w.engine.view(t)).toMatchObject({ status: 'work', on: 'pi' })
    // the backup can't go on either: it waits for you
    w.agentIs(key, 'idle')
    w.engine.retry = () => ({ cut: 'e9', tries: 1, reason: 'Signed out', words: '401', over: true })
    await w.engine.cantGoOn(t.id, 'Signed out')
    expect(w.started.filter((x) => x.key === key)).toHaveLength(2)
    expect(w.engine.view(t)).toMatchObject({ status: 'need', sub: 'Signed out' })
  })
})

describe('restarting a task agent', () => {
  test('on its own CLI it resumes, interrupted first while it works, on the new model and effort, with a card', async () => {
    const w = world()
    w.engine.installed = () => true
    const { t, key } = await started(w, repo(), 'restart-same')
    w.agentIs(key, 'working')
    const on = await w.engine.restart(t.id, { kind: 'claude', model: 'sonnet', effort: 'low' })
    expect(on).toBe('Claude Code (Sonnet 5.5, low)')
    expect(w.stopped).toEqual([key])
    const s = w.started.filter((x) => x.key === key)
    expect(s).toHaveLength(2)
    expect(s[1]).toMatchObject({ kind: 'claude', model: 'claude-sonnet-5-5', effort: 'low', cwd: t.worktree })
    // a hidden line, not the brief again
    expect(s[1].first).toStartWith('<lineclear><restart>')
    expect(s[1].first).toContain('restarted you on Claude Code (Sonnet 5.5, low), with your session as it was')
    expect(t.agent).toEqual({ kind: 'claude', model: 'claude-sonnet-5-5', effort: 'low' })
    expect(w.posted.find((p) => p.key === key && p.id.startsWith('restart:'))?.card).toMatchObject({
      restart: true,
      text: 'Restarted on Claude Code (Sonnet 5.5, low)',
    })
  })

  test('on another CLI it takes over with the brief, the branch so far and the chat; the worktree and branch stay', async () => {
    const w = world()
    w.engine.installed = () => true
    const { t, key } = await started(w, repo(), 'restart-other')
    sh('echo hi > hello.txt && git add -A && git commit -qm "Add hello.txt"', t.worktree!)
    writeFileSync(join(t.worktree!, 'more.txt'), 'more\n')
    w.chat.messages = [
      { who: 'you', text: 'Say hello\n\nAdd hello.txt. Merge when done.' },
      { who: 'agent', text: 'Added hello.txt; next the tests.' },
    ]
    const head = sh('git rev-parse HEAD', t.worktree!)
    w.agentIs(key, 'idle')
    await w.engine.restart(t.id, { kind: 'codex' })
    const s = w.started.filter((x) => x.key === key)
    expect(s[1]).toMatchObject({ kind: 'codex', cwd: t.worktree })
    expect(s[1].first).toContain('Say hello\n\nAdd hello.txt. Merge when done.')
    expect(s[1].first).toContain('Claude Code ran it until now')
    expect(s[1].first).toContain('Add hello.txt')
    expect(s[1].first).toContain('?? more.txt')
    expect(s[1].first).toContain('Claude Code: Added hello.txt; next the tests.')
    expect(w.stopped).toEqual([])
    expect(sh('git rev-parse HEAD', t.worktree!)).toBe(head)
    expect(sh('git branch --show-current', t.worktree!)).toBe(t.branch!)
    expect(existsSync(join(t.worktree!, 'more.txt'))).toBe(true)
    expect(w.engine.view(t)).toMatchObject({ on: 'Codex' })
  })

  test('a Done task, or a CLI not installed here, is refused', async () => {
    const w = world()
    const { t } = await started(w, repo(), 'restart-refused')
    w.engine.installed = (k) => k === 'claude'
    await expect(w.engine.restart(t.id, { kind: 'codex' })).rejects.toThrow("Codex isn't installed")
    await w.engine.close(t.id)
    await expect(w.engine.restart(t.id, { kind: 'claude' })).rejects.toThrow('Done already')
  })
})
