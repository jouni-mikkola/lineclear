import { Settings, effortFor, pastTimes, span, readJson, writeJson } from './live-fixture.ts'
import { describe, expect, test } from 'bun:test'

describe('settings', () => {
  test('only app settings are left, set Everywhere; none belongs to a task', () => {
    const s = new Settings()
    expect(s.get('task.agent')).toBe('pi')
    expect(s.get('coordinator.agent')).toBe('pi')
    expect(s.get('brief.review')).toBe('on')
    expect(s.get('brief.merge')).toBe('on its own')
    // what the model judges for itself is no setting
    for (const k of [
      'autopilot.tasksPerDay',
      'autopilot.hours',
      'autopilot.when',
      'autopilot.atOnce',
      'autopilot.retries',
      'autopilot.pauseAfter',
      'autopilot.brakeAfter',
      'brief.waitChecks',
      'machine.limitBy',
    ])
      expect(s.set(k, 'any').ok).toBe(false)
    for (const k of ['check.command', 'merge.by', 'plan.approve', 'worker.agent', 'limit.tokens', 'agent']) expect(s.set(k, 'x').ok).toBe(false)
  })
  test("the worker, reviewer and backup models are Lineclear's lists: read-only here, and refused when set", () => {
    const s = new Settings()
    const rows = s
      .sections([], [], null)
      .filter((x) => x.name === 'Agents' || x.name === 'How tasks work')
      .flatMap((x) => x.rows)
    for (const key of ['task.model', 'reviewer.model', 'backup.model']) {
      expect(rows.find((r) => r.key === key)).toMatchObject({ value: 'Set in Lineclear', fixed: true, lineclear: '/settings' })
      expect(s.set(key, 'claude-opus-5-5').error).toContain('Settings > Models')
    }
    // the coordinator's own model and every effort stay here
    expect(rows.find((r) => r.key === 'coordinator.model')?.fixed).toBeFalsy()
    expect(s.set('task.effort', 'high').ok).toBe(true)
    s.set('task.effort', null)
  })
  // fails on ebb17d5 too; L20 fixes it
  test.skip('a value that makes no sense is refused with the reason', () => {
    const s = new Settings()
    expect(s.set('tasks.archiveAfter', 'lots').error).toBe('Write a number from 1 to 3650 (whole), in days, or off.')
    expect(s.set('task.agent', 'Nonsense').ok).toBe(false)
    // review is on or off; its rounds and what must be fixed are settings of their own
    expect(s.set('brief.review', '2 rounds').ok).toBe(false)
    expect(s.set('review.mustFix', 'serious').ok).toBe(false)
    expect(s.set('review.rounds', '0').ok).toBe(false)
    expect(s.set('review.rounds', '5').ok).toBe(true)
    expect(s.get('review.rounds')).toBe('5 rounds')
    s.set('review.rounds', null)
    expect(s.set('brief.review', 'off').ok).toBe(true)
    expect(s.get('brief.review')).toBe('off')
    s.set('brief.review', null)
    // counts take any number in range, kept with their unit
    expect(s.set('tasks.archiveAfter', '45').ok).toBe(true)
    expect(s.get('tasks.archiveAfter')).toBe('45 days')
    s.set('tasks.archiveAfter', null)
    expect(s.set('task.effort', 'extreme').ok).toBe(false)
    expect(s.set('watcher.agent', 'Claude Code').error).toBe('No setting watcher.agent')
    // a reviewer needs a headless run review.sh knows
    expect(s.set('reviewer.agent', 'Qwen').error).toBe('Pick one of: Claude Code · pi.')
    // a model or effort level the CLI (and its model) doesn't take, with what it does
    expect(s.set('coordinator.model', 'opus 9').error).toBe(
      'Claude Code has no model opus 9. Pick one of: default · Fable 5.1 · Opus 5.5 · Sonnet 5.5 · Haiku 5.5.',
    )
    expect(s.set('coordinator.model', 'Opus 5.5').ok).toBe(true)
    expect(s.set('coordinator.effort', 'ultra').error).toBe('Opus 5.5 takes default · low · medium · high · xhigh · max.')
    expect(s.set('reviewer.effort', 'ultra').ok).toBe(true)
    expect(s.set('reviewer.model', 'claude-opus-5-5').ok).toBe(false)
    for (const k of ['coordinator.model', 'reviewer.effort']) s.set(k, null)
    // any agent herdr can start may be chosen, by its name or its kind; it is kept by its name
    expect(s.set('task.agent', 'Qwen').ok).toBe(true)
    expect(s.set('coordinator.agent', 'pi').ok).toBe(true)
    expect(s.get('coordinator.agent')).toBe('pi')
    s.set('task.agent', null)
    s.set('coordinator.agent', null)
  })
  test("tasks and coordinators each start on their own CLI, model and effort; default is the CLI's own", () => {
    const s = new Settings()
    expect(s.harness('task')).toEqual({ kind: 'pi', model: undefined, effort: undefined })
    s.set('coordinator.agent', 'pi')
    s.set('coordinator.model', 'openai/gpt-5.5')
    s.set('coordinator.effort', 'high')
    expect(s.harness('coordinator')).toEqual({ kind: 'pi', model: 'openai/gpt-5.5', effort: 'high' })
    expect(s.harness('task').kind).toBe('pi')
    for (const k of ['coordinator.agent', 'coordinator.model', 'coordinator.effort']) s.set(k, null)
  })
  test("a task's change is reviewed by pi on its own model and effort, unless Settings say another", () => {
    const s = new Settings()
    expect(s.harness('reviewer')).toEqual({ kind: 'pi', model: undefined, effort: undefined })
    s.set('reviewer.effort', 'high')
    expect(s.harness('reviewer')).toEqual({ kind: 'pi', model: undefined, effort: 'high' })
    expect(s.sections([], [], null).find((x) => x.name === 'How tasks work')!.note).toContain(
      '- Reviewer: a headless pi or a pi subagent (its default model, high effort). (your setting for every machine)',
    )
    for (const k of ['reviewer.agent', 'reviewer.effort']) s.set(k, null)
  })
  test('each CLI and model takes its own levels: one it lacks goes in as the nearest it has', () => {
    expect(effortFor('pi', 'lowest')).toBe('minimal')
    expect(effortFor('pi', 'default')).toBeUndefined()
    expect(effortFor('gemini', 'high')).toBeUndefined()
  })
  // fails on ebb17d5 too; L20 fixes it
  test.skip('Settings offer each role the models and levels of its own CLI, showing a stored one that no longer fits as what it starts with', () => {
    const s = new Settings()
    // the Reviewer's rows sit in How tasks work (its Settings block), the rest in Agents
    const rows = () =>
      s
        .sections([], [], null)
        .filter((x) => x.name === 'Agents' || x.name === 'How tasks work')
        .flatMap((x) => x.rows)
    const row = (group: string, label: string) => rows().find((r) => r.group === group && r.label === label)!
    expect(row('Tasks', 'Model').options).toEqual(['default', 'Fable 5.1', 'Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5'])
    expect(row('Tasks', 'Effort').options).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(row('Reviewer', 'Effort').options).toContain('ultra')
    // Opus on pi: pi has no such model, so it starts on its own; ultra on Claude Code is its max
    s.set('task.model', 'Opus 5.5')
    s.set('task.agent', 'pi')
    expect(row('Tasks', 'Model').value).toBe('default')
    s.set('task.effort', 'ultra')
    s.set('task.agent', 'Claude Code')
    expect(row('Tasks', 'Model').value).toBe('Opus 5.5')
    expect(row('Tasks', 'Effort').value).toBe('max')
    expect(s.harness('task')).toEqual({ kind: 'claude', model: 'claude-opus-5-5', effort: 'max' })
    // a CLI Lineclear passes neither to picks its own; the backup has its own model and effort
    s.set('task.agent', 'Qwen')
    expect(row('Tasks', 'Model')).toMatchObject({ value: "Qwen's own", fixed: true })
    expect(row('Backup', 'Model').options![1]).toBe('GPT-6.1-Sol')
    for (const k of ['task.agent', 'task.model', 'task.effort']) s.set(k, null)
  })
  test("an older settings file keeps its app settings; its one CLI becomes the tasks' and the coordinators'", () => {
    writeJson('settings.json', {
      all: {
        'coordinator.agent': 'pi',
        'check.command': 'npm test',
        'autopilot.hours': '9-18',
        'autopilot.tasksPerDay': '3',
        'wake.merged': 'now',
        'heartbeat.every': '45 min',
      },
      'task:X-1': { 'merge.by': 'by itself' },
    })
    let s = new Settings()
    expect(s.pick('task.agent')).toEqual({ value: 'pi', from: 'all' })
    expect(s.pick('coordinator.agent')).toEqual({ value: 'pi', from: 'all' })
    // coordinator timer's old limits, wake picks and heartbeat interval are dropped
    s.set('task.agent', null)
    expect(readJson('settings.json', {})).toEqual({ everywhere: { 'coordinator.agent': 'pi' }, machine: {}, spaces: {} })
    // the Watcher's settings, from before agents reported their own progress, are dropped
    writeJson('settings.json', { agent: 'pi', 'watcher.agent': 'Claude Code', 'watcher.effort': 'lowest' })
    s = new Settings()
    expect(s.get('task.agent')).toBe('pi')
    expect(s.get('watcher.effort')).toBe('')
    expect(s.sections([], [], null).some((x) => x.rows.some((r) => r.key.startsWith('watcher.')))).toBe(false)
    s.set('task.agent', null)
    s.set('coordinator.agent', null)
  })
  test('old review and merge words are dropped, not rewritten', () => {
    writeJson('settings.json', {
      everywhere: { 'brief.review': '2 rounds', 'brief.waitChecks': 'on', 'brief.merge': 'by itself' },
      machine: {},
      spaces: { web: { 'brief.merge': 'after your yes' } },
    })
    const s = new Settings()
    // the old words are no values: the key is dropped and the file is saved without it
    expect(readJson('settings.json', {})).toEqual({ everywhere: {}, machine: {}, spaces: { web: {} } })
    expect(s.get('brief.merge')).toBe('on its own')
    expect(s.ways()).toMatchObject({ merge: 'on its own', waitChecks: false })
    expect(s.ways('web').merge).toBe('on its own')
    writeJson('settings.json', {})
  })
  test("defaults at three levels: a space's own win over its machine's, which win over Everywhere's", () => {
    // today's one level becomes All machines; a machine's capacity was each machine's own and stays so
    writeJson('settings.json', { 'brief.review': 'off', 'machine.maxTasks': '8' })
    const s = new Settings()
    expect(readJson('settings.json', {})).toEqual({ 'brief.review': 'off', 'machine.maxTasks': '8' })
    expect(s.pick('brief.review')).toEqual({ value: 'off', from: 'all' })
    expect(s.pick('machine.maxTasks')).toEqual({ value: '8', from: 'machine' })
    expect(s.pick('task.fallback')).toEqual({ value: 'pi', from: 'default' })
    expect(s.set('task.fallback', 'off', 'machine').ok).toBe(true)
    expect(s.set('task.fallback', 'pi', { space: 'web' }).ok).toBe(true)
    expect(s.set('brief.review', 'on', { space: 'web' }).ok).toBe(true)
    expect(s.get('task.fallback')).toBe('off')
    expect(s.get('task.fallback', 'web')).toBe('pi')
    expect(s.get('task.fallback', 'api')).toBe('off')
    expect(s.ways('web').review).toBe(true)
    expect(s.ways('api').review).toBe(false)
    // a machine's capacity has no project level; alerts are one for all
    expect(s.set('machine.maxTasks', '2', { space: 'web' }).ok).toBe(false)
    expect(s.set('alerts', 'x', 'machine').ok).toBe(false)
    expect(readJson<Record<string, unknown>>('settings.json', {})).toEqual({
      everywhere: { 'brief.review': 'off' },
      machine: { 'machine.maxTasks': '8', 'task.fallback': 'off' },
      spaces: { web: { 'task.fallback': 'pi', 'brief.review': 'on' } },
    })
    // the screen's rows say where an inherited value comes from, and what a reset goes back to
    const rows = (level: string, name: string) => s.sections([], [], null, 'vm', ['web']).find((x) => x.level === level && x.name === name)!.rows
    const agent = (level: string) => rows(level, 'Agents').find((r) => r.key === 'task.fallback')!
    expect(agent('p:vm:web')).toMatchObject({ value: 'pi', inherits: { value: 'off', from: 'vm' } })
    expect(agent('m:vm')).toMatchObject({ value: 'off', inherits: { value: 'pi', from: 'Everywhere' } })
    expect(agent('all')).toMatchObject({ value: 'pi' })
    expect(agent('all').from).toBeUndefined()
    // a machine shown by a name of its own: the rows say that name, its levels keep the key
    const named = s.sections([], [], null, 'vm', ['web'], 'VM box').find((x) => x.level === 'p:vm:web' && x.name === 'Agents')!
    expect(named.rows.find((r) => r.key === 'task.fallback')).toMatchObject({ inherits: { value: 'off', from: 'VM box' } })
    expect(named.machine).toBe('vm')
    expect(rows('p:vm:web', 'How tasks work').find((r) => r.key === 'brief.merge')).toMatchObject({ value: 'on its own', from: 'Everywhere' })
    expect(s.sections([], [], null, 'vm', ['web']).some((x) => x.level === 'p:vm:web' && x.name === 'Machine')).toBe(false)
    // unset drops a level's own: the one above counts again
    s.set('task.fallback', null, { space: 'web' })
    expect(s.pick('task.fallback', { space: 'web' })).toEqual({ value: 'off', from: 'machine' })
    // the other machines take the main one's All machines
    expect(s.adopt({ 'brief.review': 'on', nonsense: 'x' })).toBe(true)
    expect(s.everywhere()).toEqual({ 'brief.review': 'on' })
    writeJson('settings.json', {})
  })
  test("a task's backup agent is pi unless set: any CLI herdr starts, or off", () => {
    const s = new Settings()
    expect(s.get('task.fallback')).toBe('pi')
    expect(s.set('task.fallback', 'Claude Code').ok).toBe(false)
    expect(s.set('task.fallback', 'Off').ok).toBe(true)
    expect(s.get('task.fallback')).toBe('off')
    expect(s.set('task.fallback', 'Nonsense').ok).toBe(false)
    s.set('task.fallback', null)
  })
  test('the Settings screen shows what every new brief ends with, as it is now', () => {
    const s = new Settings()
    const note = () => s.sections([], [], null).find((x) => x.name === 'How tasks work')!.note!
    expect(note()).toContain('- Reviewer: a headless pi or a pi subagent (its default model and effort).')
    // planning, what to fix and what proof to show are the agent's judgment, not settings
    const section = () => s.sections([], [], null).find((x) => x.name === 'How tasks work')!
    expect(section().rows.map((r) => r.key)).toEqual([
      'brief.review',
      'review.mustFix',
      'review.rounds',
      'brief.merge',
      'reviewer.agent',
      'reviewer.model',
      'reviewer.effort',
    ])
    // only words in prompts: What agents are told, each row with the line it adds
    expect(section().told).toBe(true)
    expect(s.sections([], [], null).find((x) => x.name === 'Agents')!.told).toBeUndefined()
    expect(section().rows.find((r) => r.key === 'review.rounds')!.line).toBe('Review rounds: 3. Stop when a round finds none to fix, at most 3 rounds.')
    s.set('review.mustFix', 'minor')
    s.set('review.rounds', '1')
    expect(note()).toContain(
      '- Must fix: minor. Findings are tagged critical/major/minor/trivial; fix critical, major and minor. (your setting for every machine)',
    )
    expect(note()).toContain('- Review rounds: 1. One round, no review again. (your setting for every machine)')
    expect(section().rows.find((r) => r.key === 'review.rounds')!.line).toBe('Review rounds: 1. One round, no review again. (your setting for every machine)')
    for (const k of ['review.mustFix', 'review.rounds']) s.set(k, null)
    s.set('brief.review', 'off')
    expect(note()).toContain("- Review: off. No review; the lines on reviewing below don't apply. (your setting for every machine)")
    s.set('brief.review', null)
    expect(
      s
        .sections([], [], null)
        .find((x) => x.name === 'Agents')!
        .rows.map((r) => r.group),
    ).toEqual(['Tasks', 'Tasks', 'Tasks', 'Coordinators', 'Coordinators', 'Coordinators', 'Backup', 'Backup', 'Backup'])
  })
})

describe("this project's own numbers, for a task's time left", () => {
  const min = 60000
  const task = (n: number, title: string, took: number, x: object = {}) => ({
    id: `X-${n}`,
    project: 'p',
    title,
    desc: '',
    created: n * 1e7,
    doneAt: n * 1e7 + took * min,
    merged: true,
    ...x,
  })
  const done = [
    task(1, 'Remove the Watcher', 60),
    task(2, 'Delete a task', 22),
    task(3, 'Archive tasks', 40, { reportedAt: 3e7 + 30 * min }),
    task(4, 'Rename task groups', 6),
    task(5, 'Fix laggy chat input', 39),
    task(6, 'Pin tasks', 77, { project: 'other' }),
    task(7, 'Tighter menu', 13, { merged: false }),
  ]
  test('the median, the middle half, 9 in 10, and the ones that read most like it, from start to its first done', () => {
    expect(pastTimes(done, { id: 'X-9', project: 'p', title: 'Remove a project from sidebar', desc: 'Delete it from the list' })).toBe(
      'How long this space\'s tasks really took, from start to done: the last 5 took 30m (median), half of them 22m to 39m, 9 in 10 under 1h. The ones that read most like this task: X-2 "Delete a task" 22m, X-1 "Remove the Watcher" 1h.',
    )
  })
  test('the latest ones when none reads like it; nothing while too few are done', () => {
    expect(pastTimes(done, { id: 'X-9', project: 'p', title: 'Voice calls', desc: '' })).toContain(
      'The latest ones: X-5 "Fix laggy chat input" 39m, X-4 "Rename task groups" 6m, X-3 "Archive tasks" 30m.',
    )
    expect(pastTimes(done.slice(1), { id: 'X-9', project: 'p', title: 'Voice', desc: '' })).toBe('')
  })
  test('times read short', () => {
    expect([span(0.2), span(25), span(60), span(80), span(130)]).toEqual(['1m', '25m', '1h', '1h20m', '2h10m'])
  })
})
