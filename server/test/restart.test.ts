// What a restart says and offers: the hint once Settings say other than what an agent runs on, a harness in words,
// and what an agent taking over is told.
import { describe, expect, test } from 'bun:test'
import { fitHarness, harnessProblem, harnessWords, launchHarness, restartInfo, recentChat, restartHint, sameHarness } from '../server/live/restart.ts'
import { setRegistry } from '../../src/models.ts'
import { restartLine, resumedLine } from '../server/live/prompts.ts'

setRegistry([
  { harness: 'pi', provider: 'acme', name: 'big-1' },
  { harness: 'pi', provider: 'acme', name: 'small-1' },
])

describe('the restart hint', () => {
  test('says the first that differs: the model, the effort', () => {
    expect(restartHint({ kind: 'pi', model: 'big-1' }, undefined, { kind: 'pi', model: 'acme/small-1' })).toEqual({ on: 'big-1', want: 'small-1' })
    expect(restartHint({ kind: 'pi', effort: 'high' }, undefined, { kind: 'pi' })).toEqual({ on: 'high effort', want: 'default effort' })
    expect(restartHint({ kind: 'pi', model: '' }, undefined, { kind: 'pi', model: 'acme/big-1' })).toEqual({
      on: "pi's default model",
      want: 'big-1',
    })
  })

  test('none while they agree, a model by its name or id', () => {
    expect(restartHint({ kind: 'pi', model: 'big-1', effort: 'high' }, undefined, { kind: 'pi', model: 'acme/big-1', effort: 'high' })).toBeUndefined()
    expect(restartHint({ kind: 'pi', model: '', effort: '' }, undefined, { kind: 'pi' })).toBeUndefined()
    expect(sameHarness({ kind: 'pi', effort: 'High' }, { kind: 'pi', effort: 'high' })).toBe(true)
  })

  test('none while Settings say what they said when it started: a pick of its own is no change of Settings', () => {
    // started on Settings' big model, then switched to the small one in the chat's + menu
    expect(restartHint({ kind: 'pi', model: 'small-1' }, { kind: 'pi', model: 'acme/big-1' }, { kind: 'pi', model: 'acme/big-1' })).toBeUndefined()
    // Settings changed since
    expect(restartHint({ kind: 'pi', model: 'small-1' }, { kind: 'pi', model: 'acme/big-1' }, { kind: 'pi', model: 'acme/big-1', effort: 'low' })).toEqual({
      on: 'small-1',
      want: 'big-1',
    })
  })
})

describe('a harness', () => {
  test('in words, and as Lineclear passes it', () => {
    expect(harnessWords({ kind: 'pi' })).toBe('pi')
    expect(harnessWords({ kind: 'pi', model: 'big-1', effort: 'high' })).toBe('pi (big-1, high)')
    expect(fitHarness({ kind: 'pi', model: 'big-1', effort: 'default' })).toEqual({ kind: 'pi', model: 'acme/big-1' })
    expect(fitHarness({ kind: 'pi', model: 'default', effort: '' })).toEqual({ kind: 'pi' })
  })
})

describe('what the agent is told', () => {
  test('another agent takes over: who ran it, a task its commits and changes, the chat so far', () => {
    const chat = recentChat(
      [
        { id: '1', who: 'you', text: 'The brief', at: 1 },
        { id: '2', who: 'you', text: 'Use blue', at: 2 },
        { id: '3', who: 'agent', text: 'On it', at: 3 },
        { id: '4', who: 'agent', card: { id: 'c', text: 'Restarted' }, at: 4 },
      ] as never,
      'pi',
      'The brief',
    )
    expect(chat).toBe('Human: Use blue\n\npi: On it')
    const task = restartLine({ from: 'pi', to: 'pi (big-1, high)', chat, commits: 'a1 Add x', changes: '' })
    expect(task).toContain('restarted this task on pi (big-1, high). pi ran it until now')
    expect(task).toContain('same worktree and branch')
    expect(task).toContain('Commits on the branch so far:\na1 Add x')
    expect(task).toContain('Uncommitted changes:\nnone')
    expect(task).toContain('Human: Use blue')
    const coord = restartLine({ from: 'pi', to: 'pi', chat })
    expect(coord).toContain('restarted this chat on pi')
    expect(coord).not.toContain('Commits')
  })

  test('its own CLI resumes: carry on, or say nothing', () => {
    expect(resumedLine('pi (big-1, high)')).toContain('<no-reply>restarted</no-reply>')
  })
})

describe('visible launch settings and supported restart choices', () => {
  test('both roles keep recorded launch separate from inherited Settings', () => {
    for (const role of ['task', 'coordinator'] as const) {
      const info = restartInfo({
        role,
        on: { kind: 'pi' },
        want: { kind: 'pi', model: 'big-1', effort: 'high' },
        kinds: ['pi'],
        working: true,
      })
      expect(info.on).toEqual({ kind: 'pi' })
      expect(info.want).toEqual({ kind: 'pi', model: 'acme/big-1', effort: 'high' })
    }
  })
  test('launch metadata matches CLI flags, including unsupported and rounded effort', () => {
    expect(launchHarness({ kind: 'gemini', model: 'saved-only', effort: 'high' })).toEqual({ kind: 'gemini' })
    expect(launchHarness({ kind: 'pi', model: 'Small-1', effort: 'ultra' })).toEqual({ kind: 'pi', model: 'acme/small-1', effort: 'max' })
    expect(launchHarness({ kind: 'pi', model: 'default', effort: 'default' })).toEqual({ kind: 'pi' })
  })
  test('unavailable models, other CLIs and unsupported effort are refused instead of rounded', () => {
    expect(harnessProblem({ kind: 'gemini', effort: 'high' })).toContain('does not support')
    expect(harnessProblem({ kind: 'pi', model: 'provider/model' })).toContain('no available model')
    expect(harnessProblem({ kind: 'pi', model: 'acme/big-1', effort: 'high' })).toBeUndefined()
    expect(harnessProblem({ kind: 'pi', effort: 'nonsense' })).toContain('does not support nonsense effort')
  })
})

test('restart offers readable chat kinds, including when the current agent has no reader', () => {
  const info = restartInfo({
    role: 'task',
    on: { kind: 'agy' },
    want: { kind: 'pi' },
    kinds: ['agy', 'gemini', 'pi'],
    working: false,
  })
  expect(info.on.kind).toBe('agy')
  expect(info.clis.map((c) => c.kind)).toEqual(['pi'])
})
