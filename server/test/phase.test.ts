// A task is in one phase, moves only by `transitions`, and keeps its phase across a restart (L521).
import { describe, expect, test } from 'bun:test'
import { type Phase, type PhaseEvent, PHASES, EVENTS, move, transitions } from '../server/live/engine/phase.ts'
import { placeId, repo, writeJson, world } from './engine-world.ts'

describe('phase transitions', () => {
  test('every pair of (phase, event) gives the listed next phase or a refusal', () => {
    for (const phase of PHASES)
      for (const event of EVENTS) {
        const t: { phase?: Phase } = { phase: phase === 'idle' ? undefined : phase }
        const want = transitions[phase][event]
        expect(move(t, event)).toBe(want !== undefined)
        expect(t.phase ?? 'idle').toBe(want ?? phase)
      }
  })

  test('the table lists only known phases and events', () => {
    expect(Object.keys(transitions).sort()).toEqual([...PHASES].sort())
    for (const row of Object.values(transitions)) {
      for (const [event, to] of Object.entries(row)) {
        expect(EVENTS).toContain(event as PhaseEvent)
        expect(PHASES).toContain(to as Phase)
      }
    }
  })
})

/** a task record as the store keeps it */
function record(project: string, n: number, more: object) {
  return { id: `PH-${n}`, n, project, title: `Task ${n}`, desc: '', by: 'test', created: Date.now(), updated: Date.now(), ...more }
}

describe('phase across a restart', () => {
  for (const phase of PHASES) {
    test(`a restart in ${phase} shows the same status`, async () => {
      const dir = repo()
      const p = await world().places.add(dir, `phase-${phase}`)
      const project = placeId.space(p.name)
      writeJson('tasks.json', {
        next: { [p.key]: 2 },
        tasks: [record(project, 1, { phase: phase === 'idle' ? undefined : phase, told: 'todo', worktree: '/tmp/phase-wt', branch: 'phase' })],
      })
      const first = world()
      const t1 = first.engine.tasks[0]
      expect(t1.phase ?? 'idle').toBe(phase)
      const status = first.engine.statusOf(t1)
      const second = world()
      const t2 = second.engine.tasks[0]
      expect(t2.phase ?? 'idle').toBe(phase)
      expect(second.engine.statusOf(t2)).toBe(status)
      if (phase === 'starting' || phase === 'briefing') expect(status).toBe('todo')
      if (phase === 'handing') expect(status).toBe('work')
    })
  }

  test('once the engine is up, a start, handoff or clean-up the last run was in is over and a brief phase stays', async () => {
    const dir = repo()
    const p = await world().places.add(dir, 'phase-ended')
    const project = placeId.space(p.name)
    const own = { told: 'work', worktree: '/tmp/phase-wt', branch: 'phase' }
    writeJson('tasks.json', {
      next: { [p.key]: 5 },
      tasks: ['handing', 'cleaning', 'briefing'].map((phase, i) => record(project, i + 1, { ...own, phase })),
    })
    const w = world()
    w.engine.resumeAfterStart()
    expect(w.engine.tasks.map((t) => t.phase)).toEqual([undefined, undefined, 'briefing'])
    expect(w.engine.statusOf(w.engine.tasks[2])).toBe('todo')
  })
})

describe('the start waits for pi', () => {
  test('a restart in starting sends the brief once, however often it is resumed', async () => {
    const dir = repo()
    const p = await world().places.add(dir, 'phase-once')
    const project = placeId.space(p.name)
    writeJson('tasks.json', {
      next: { [p.key]: 2 },
      tasks: [record(project, 1, { told: 'work', worktree: '/tmp/phase-wt', branch: 'phase', phase: 'starting', going: 'Go: start now.' })],
    })
    const w = world()
    w.engine.resumeAfterStart()
    w.engine.resumeAfterStart()
    expect(w.sent.filter((x) => x.key === 'PH-1/Agent').length).toBe(1)
  })

  test('a task whose agent exited is orphaned at that event, not after hours', async () => {
    const dir = repo()
    const p = await world().places.add(dir, 'phase-orphan')
    const project = placeId.space(p.name)
    writeJson('tasks.json', {
      next: { [p.key]: 2 },
      tasks: [record(project, 1, { told: 'work', worktree: '/nonexistent', branch: 'phase' })],
    })
    const w = world()
    w.engine.resumeAfterStart()
    w.agentIs('PH-1/Agent', 'working')
    expect(w.engine.view(w.engine.tasks[0]).orphaned).toBeUndefined()
    w.agentIs('PH-1/Agent', 'gone')
    expect(w.engine.view(w.engine.tasks[0]).orphaned).toBe(true)
  })
})

describe('settling one task', () => {
  test('45 held tasks among 561 stored make no status scan of the others', async () => {
    const dir = repo()
    const p = await world().places.add(dir, 'phase-scan')
    const project = placeId.space(p.name)
    const tasks = Array.from({ length: 561 }, (_, i) =>
      i < 45
        ? record(project, i + 1, { told: 'queued', held: { why: 'slots', since: Date.now() + i } })
        : record(project, i + 1, { told: 'work', worktree: `/tmp/phase-scan-${i}`, branch: `b${i}` }),
    )
    writeJson('tasks.json', { next: { [p.key]: 562 }, tasks })
    const w = world()
    w.settings.set('machine.maxTasks', '50')
    for (const t of w.engine.tasks) if (t.told === 'work') w.status[`${t.id}/Agent`] = 'working'
    const seen: string[] = []
    const statusOf = w.engine.statusOf.bind(w.engine)
    w.engine.statusOf = (t) => (seen.push(t.id), statusOf(t))
    const one = w.engine.tasks[0]
    ;(w.engine as unknown as { settle(t: unknown): void }).settle(one)
    expect(seen.filter((id) => id !== one.id)).toEqual([])
  })
})
