import { describe, expect, test } from 'bun:test'
import { repo, world, until, started } from './engine-world.ts'

describe('recovered private routing failures', () => {
  const failure = 'Could not provision private agent command routing'
  async function failed(name: string) {
    const w = world()
    const ensure = w.agents.ensure
    w.agents.ensure = async (spec) => {
      await ensure(spec) // the same CLI survived the failed route provisioning
      throw new Error(failure)
    }
    const { t, key } = await started(w, repo(), name)
    await until(() => !!t.trouble)
    expect(w.engine.view(t)).toMatchObject({ status: 'need', outcome: 'failed', sub: 'Went wrong: Could not provision private' })
    return { w, t, key }
  }

  test('same agent recovers only after its private route is verified', async () => {
    const { w, t, key } = await failed('route-recovers')
    w.engine.report(t.id, 'Writing evidence', 80)
    expect(t.trouble).toBe(failure)
    w.routed[key] = true
    w.engine.agentStatus(key)
    w.engine.report(t.id, 'Still writing evidence', 80)
    expect(t.trouble).toBe(failure) // cached route + working status is not a fresh process check
    w.engine.routeRecovered(key) // route repair also notifies when status did not change
    expect(t.trouble).toBeUndefined()
    expect(w.engine.view(t)).toMatchObject({ status: 'work', sub: 'Working' })
    expect(w.engine.outcomeOf(t)).toBeUndefined()
    // Unrelated failures never disappear merely because the CLI is working.
    t.trouble = 'Could not make a worktree'
    w.engine.routeRecovered(key)
    expect(w.engine.outcomeOf(t)).toBe('failed')
  })

  test('a genuine retry failure remains failed', async () => {
    const { w, t, key } = await failed('route-retry-fails')
    w.agents.send = async () => {
      throw new Error(failure)
    }
    await expect(w.engine.tell(t.id, 'Try again')).rejects.toThrow(failure)
    w.engine.agentStatus(key)
    expect(t.trouble).toBe(failure)
    expect(w.engine.outcomeOf(t)).toBe('failed')
  })

  test('recovery preserves open questions and permission prompts', async () => {
    const { w, t, key } = await failed('route-question')
    w.chat.card = 'ask'
    w.chat.cardTitle = 'Which route?'
    expect(w.engine.view(t)).toMatchObject({ status: 'need', sub: 'Which route?', outcome: 'failed' })
    w.routed[key] = true
    w.engine.routeRecovered(key)
    // its agent works again: it went on without the answer, so the task works (the card stays open)
    expect(w.engine.view(t)).toMatchObject({ status: 'work' })
    w.agentIs(key, 'idle')
    expect(w.engine.view(t)).toMatchObject({ status: 'need', sub: 'Which route?' })
    expect(w.engine.outcomeOf(t)).toBeUndefined()
    w.chat.card = undefined
    w.chat.question = true
    expect(w.engine.view(t)).toMatchObject({ status: 'need', sub: 'Which one?' })
    w.chat.question = false
    w.agentIs(key, 'blocked')
    expect(w.engine.view(t)).toMatchObject({ status: 'need', sub: 'Asks permission' })
  })

  test('an old report and route cannot revive a stopped agent', async () => {
    const { w, t, key } = await failed('route-stopped')
    w.routed[key] = true
    w.agentIs(key, 'gone')
    w.engine.routeRecovered(key)
    w.engine.report(t.id, 'Writing evidence', 80)
    expect(w.engine.view(t)).toMatchObject({ status: 'need', outcome: 'failed' })
    expect(t.trouble).toBe(failure)
  })

  test('recovered work completes normally', async () => {
    const { w, t, key } = await failed('route-done')
    w.routed[key] = true
    w.engine.routeRecovered(key)
    w.engine.report(t.id, 'Writing evidence', 80)
    expect(t.trouble).toBeUndefined()
    expect(await w.engine.done(t.id, 'Investigation complete')).toBe('closed')
    expect(w.engine.view(t)).toMatchObject({ status: 'done', outcome: 'done', sub: 'Nothing to merge' })
  })
})
