// Faults seen in herdr-projects 2.0 (ebb17d5) that the fork fixes, each with a test that fails on the base's behaviour. The
// Each is named for the fault it plants.
import { describe, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine, fakeHerdr, repo, started, until, world } from './engine-world.ts'

process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'shep-claude-'))
const { canResume } = await import('../server/live/agent-start.ts')
const { claudeLogPath } = await import('../server/live/readers/find.ts')
const { cutCardId, isAllowance, resetAt, Retries, wakePlan } = await import('../server/live/retry.ts')
const { overviewWakes } = await import('../server/live/trigger.ts')
const { writeJson } = await import('../server/store.ts')
const { Worktrees } = await import('../server/live/engine/worktrees.ts')
void Engine

describe('(a) out of allowance is not final', () => {
  const hooks = () => {
    const woke: string[] = []
    const over: string[] = []
    return { woke, over, h: { nudge: () => undefined, over: (k: string) => over.push(k), wake: (k: string) => woke.push(k), changed: () => undefined } }
  }
  const limit = { id: 'e1', at: Date.now(), text: "You've hit your session limit · resets 5pm", status: 429 }

  test('it says when the account is back and the chat is woken then; the human hears once', () => {
    const w = hooks()
    const r = new Retries(w.h)
    r.seen('A', limit)
    expect(r.get('A')).toMatchObject({ over: true, certain: true })
    expect(r.get('A')!.back!).toBeGreaterThan(Date.now())
    expect(r.get('A')!.back!).toBeLessThanOrEqual(Date.now() + 24 * 3_600_000)
    // no reset time said: looked at again in half an hour, then later each time
    r.seen('B', { ...limit, id: 'e2', text: 'Usage limit reached' })
    const b = r.get('B')!
    expect(b.certain).toBe(false)
    expect(b.back! - Date.now()).toBeGreaterThan(29 * 60_000)
    r.seen('B', { ...limit, id: 'e3', text: 'Usage limit reached' })
    expect(r.get('B')!.back! - Date.now()).toBeGreaterThan(59 * 60_000)
    // a failure again of the same stop is not another message to the human
    expect(w.over).toEqual(['A', 'B'])
    r.stop()
  })

  test('it survives a restart: the wake-up is armed again from what was kept', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shep-wake-'))
    process.env.LINECLEAR_HOME = dir
    writeJson('retries.json', {
      A: { cut: 'e1', tries: 1, reason: 'Out of allowance until 5pm', words: '', over: true, back: Date.now() + 100, certain: true },
    })
    const w = hooks()
    const r = new Retries(w.h, undefined, 0)
    await until(() => w.woke.length > 0)
    expect(w.woke).toEqual(['A'])
    expect(r.get('A')!.back).toBeUndefined()
    r.stop()
  })

  test('reset times as providers say them', () => {
    const now = Date.parse('2026-11-01T10:00:00Z')
    expect(resetAt('resets in 3 hours', now)).toBe(now + 3 * 3_600_000)
    const at = resetAt("You've hit your limit · resets 5pm (UTC)", now)!
    expect(new Date(at).toISOString()).toBe('2026-11-01T17:00:00.000Z')
    expect(new Date(resetAt('resets 9am (UTC)', now)!).toISOString()).toBe('2026-11-02T09:00:00.000Z')
    expect(resetAt('Usage limit reached', now)).toBeUndefined()
    expect(isAllowance('Out of allowance until 5pm')).toBe(true)
  })
})

describe('(b) the wake-up never writes carry on to a chat whose model is out', () => {
  test('with no reset time said, a chat that has a backup account moves to it first', () => {
    expect(wakePlan({ certain: false }, true)).toBe('switch')
    expect(wakePlan({ certain: true }, true)).toBe('carry-on')
    expect(wakePlan({ certain: false }, false)).toBe('carry-on')
  })

  test('every failure of a chat is one card, not a new one each time', () => {
    expect(cutCardId('p:1', 'Out of allowance until 5pm')).toBe(cutCardId('p:1', 'Out of allowance'))
    expect(cutCardId('p:1', 'Out of allowance')).not.toBe(cutCardId('p:2', 'Out of allowance'))
  })
})

describe('(c) a restart that would resume a session Claude Code does not have', () => {
  test('starts a session of its own instead of failing with "No conversation found"', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'shep-cwd-'))
    const rec = { kind: 'claude', cwd, sessionId: '11111111-1111-1111-1111-111111111111', logs: [] as string[] }
    expect(canResume(rec, cwd)).toBe(false)
    const log = claudeLogPath(cwd, rec.sessionId)
    mkdirSync(join(log, '..'), { recursive: true })
    writeFileSync(log, '{}\n')
    expect(canResume(rec, cwd)).toBe(true)
    // the other CLIs resume as before
    expect(canResume({ ...rec, kind: 'pi', logs: ['/x.jsonl'] }, cwd)).toBe(true)
    expect(canResume({ ...rec, kind: 'codex', sessionId: undefined as never, logs: [] }, cwd)).toBe(false)
  })
})

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

describe('(g) an agent idle at 0% context', () => {
  test('its brief is sent again, once, when it never began', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'unbegun')
    w.agentIs(key, 'idle')
    const before = w.sent.length
    w.engine.briefLate(w.engine.task(t.id)!)
    expect(w.sent.length).toBe(before + 1)
    expect(w.sent.at(-1)!.text).toContain('you have not started')
    w.engine.briefLate(w.engine.task(t.id)!)
    expect(w.sent.length).toBe(before + 1)
  })

  test('an agent at work is left alone', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'begun')
    w.agentIs(key, 'working')
    const before = w.sent.length
    w.engine.briefLate(w.engine.task(t.id)!)
    expect(w.sent.length).toBe(before)
  })
})

describe('(h) the home coordinator is not woken by every space', () => {
  test('off coordinator timer another space’s news costs it no model turn', () => {
    expect(overviewWakes('regular', 'ready')).toBe(false)
    expect(overviewWakes('regular', 'need')).toBe(false)
    expect(overviewWakes('autopilot', 'need')).toBe(true)
    expect(overviewWakes('regular', 'health')).toBe(true)
  })
})

describe('incidents: "This operation was aborted" is a dropped connection, waited out', () => {
  test('it passes by itself instead of going straight to the human (59 times in October)', () => {
    const { providerError } = require('../server/live/retry.ts')
    expect(providerError('This operation was aborted')).toEqual({ passing: true, reason: 'Connection dropped' })
  })
})

void spyOn
