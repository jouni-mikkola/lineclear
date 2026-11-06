import {
  CATALOG,
  Settings,
  setForTask,
  coordinatorPrompt,
  settingsBlock,
  splitBrief,
  taskPrompt,
  HOST,
  keyFor,
  machineName,
  placeId,
  ROOT,
} from './live-fixture.ts'
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

describe("the brief's default way of working", () => {
  test("a task's agent is told who it is, its task's facts and which skills to read; the rules are in the skills", () => {
    const p = taskPrompt({ id: 'X-1', branch: 'work/1-x', base: 'main' }, "How long this space's tasks really took: 20m.")
    expect(p).toContain('the agent of task X-1')
    expect(p).toContain('skill/lineclear/SKILL.md first')
    expect(p).toContain('skill/lineclear-agent/SKILL.md')
    expect(p).not.toContain('lineclear-coordinator')
    expect(p).toContain('on branch work/1-x (from main)')
    expect(p).toContain("How long this space's tasks really took: 20m.")
    for (const s of ['lineclear', 'lineclear-agent', 'lineclear-coordinator']) expect(existsSync(join(ROOT, 'skill', s, 'SKILL.md'))).toBe(true)
  })
  const ways = { review: true, mustFix: 'major', rounds: 3, merge: 'on its own', waitChecks: false }
  test("the human's defaults only, one line each: review, the reviewer, the bar, the rounds and merge on its own", () => {
    expect(settingsBlock('X-1', { ways, reviewer: { kind: 'codex' } })).toBe(`Settings: (from lineclear show; where the brief above says otherwise, it wins)
- Review: on. Have your change reviewed by fresh eyes before it merges.
- Reviewer: a headless Codex or a Codex subagent (its default model and effort).
- Must fix: major. Findings are tagged critical/major/minor/trivial; fix critical and major, then review again.
- Review rounds: 3. Stop when a round finds none to fix, at most 3 rounds.
- Merge: on its own. Merge it yourself once it works (lineclear merge X-1). Don't wait for GitHub's checks.`)
  })
  test("a brief splits into the coordinator's words and the Settings block", () => {
    const how = settingsBlock('X-1', { ways })
    expect(splitBrief(`Fix it.\n\n${how}`)).toEqual(['Fix it.', how])
    expect(splitBrief('Fix it.')).toEqual(['Fix it.', ''])
  })
  test('each setting changes its line', () => {
    expect(settingsBlock('X-1', { ways: { ...ways, merge: 'ask me first' } })).toContain(
      '- Merge: ask me first. Ask the human first, and merge (lineclear merge X-1) once they say yes.',
    )
    expect(settingsBlock('X-1', { ways: { ...ways, waitChecks: true } })).toContain(
      "- Merge: after GitHub checks. Merge it yourself once it works and GitHub's checks pass (lineclear checks X-1, then lineclear merge X-1).",
    )
    // review off still shows every line, an override among them
    const off = settingsBlock('X-1', { ways: { ...ways, review: false, rounds: 1 }, reviewer: { kind: 'codex' }, by: { review: 'task', rounds: 'task' } })
    expect(off).toContain("- Review: off. No review; the lines on reviewing below don't apply. (set by coordinator for this task)")
    expect(off).toContain('- Reviewer: a headless Codex')
    expect(off).toContain('- Review rounds: 1. One round, no review again. (set by coordinator for this task)')
    expect(settingsBlock('X-1', { ways: { ...ways, mustFix: 'critical', rounds: 5 } })).toContain(
      '- Must fix: critical. Findings are tagged critical/major/minor/trivial; fix critical, then review again.\n- Review rounds: 5. Stop when a round finds none to fix, at most 5 rounds.',
    )
    expect(settingsBlock('X-1', { ways: { ...ways, mustFix: 'trivial' } })).toContain('fix all of them, then review again')
  })
  test('the Reviewer line names the reviewer, its model and effort; the Agent line what it runs on, only so it knows', () => {
    expect(settingsBlock('X-1', { ways, reviewer: { kind: 'claude', model: 'opus', effort: 'high' } })).toContain(
      '- Reviewer: a headless Claude Code or a Claude Code subagent (model opus, high effort).',
    )
    expect(settingsBlock('X-1', { ways, reviewer: { kind: 'pi', model: 'openai/gpt-5.5', effort: '' } })).toContain(
      '- Reviewer: a headless pi or a pi subagent (model openai/gpt-5.5, its default effort).',
    )
    expect(settingsBlock('X-1', { ways, agent: { kind: 'claude', effort: 'high' } })).toContain(
      '- Agent: Claude Code (its default model, high effort). Only so you know what you run on.',
    )
  })
  test('a line that differs from the default says who changed it', () => {
    const block = settingsBlock('X-1', { ways: { ...ways, rounds: 1, merge: 'ask me first' }, by: { rounds: 'task', merge: 'space' } })
    expect(block).toContain('- Review rounds: 1. One round, no review again. (set by coordinator for this task)')
    expect(block).toContain("- Merge: ask me first. Ask the human first, and merge (lineclear merge X-1) once they say yes. (this space's setting)")
  })
  test("Settings say who changed each line: a space's own, a machine's, every machine's, or the coordinator for one task", () => {
    const s = new Settings()
    expect(s.setBy()).toEqual({})
    s.set('review.rounds', '2', 'machine')
    s.set('brief.merge', 'ask me first', { space: 'web' })
    // the same as Lineclear's own default is no change
    s.set('review.mustFix', 'major')
    expect(s.setBy('web')).toEqual({ rounds: 'machine', merge: 'space' })
    expect(s.setBy('web', { 'review.mustFix': 'critical' })).toEqual({ rounds: 'machine', merge: 'space', mustFix: 'task' })
    expect(s.ways('web', { 'brief.merge': 'after GitHub checks' })).toMatchObject({ merge: 'on its own', waitChecks: true, rounds: 2 })
    for (const [k, l] of [
      ['review.rounds', 'machine'],
      ['brief.merge', { space: 'web' }],
      ['review.mustFix', 'all'],
    ] as const)
      s.set(k, null, l)
  })
  test('task add --set takes a How tasks work key or its short name, or stands for a flag; a bad one says why', () => {
    expect(setForTask('review.rounds=1')).toEqual({ key: 'review.rounds', value: '1 round' })
    expect(setForTask('merge=ask me first')).toEqual({ key: 'brief.merge', value: 'ask me first' })
    expect(setForTask("merge='ask me first'")).toEqual({ key: 'brief.merge', value: 'ask me first' })
    expect(setForTask('review=off')).toEqual({ key: 'brief.review', value: 'off' })
    expect(setForTask('agent=codex')).toEqual({ flag: 'agent', value: 'codex' })
    expect(setForTask('reviewer=claude')).toEqual({ flag: 'reviewer', value: 'claude' })
    expect(setForTask('reviewer.effort=high')).toEqual({ flag: 'reviewer-effort', value: 'high' })
    expect(setForTask('merge=whenever')).toMatchObject({ error: expect.stringContaining('Pick one of') })
    expect(setForTask('colour=blue')).toMatchObject({ error: expect.stringContaining('--set takes key=value') })
  })
})

describe("a coordinator's instructions", () => {
  test('who it is, its space and whether coordinator timer is on; its rules are in the coordinator skill', () => {
    const place = { role: 'space' as const, name: 'gtm', path: '/x/gtm', machine: 'vm-str' }
    for (const mode of ['regular', 'autopilot'] as const) {
      const p = coordinatorPrompt(place, mode)
      expect(p).toContain('the coordinator of the space gtm on vm-str (/x/gtm)')
      expect(p).not.toContain('home space')
      expect(p).toContain('skill/lineclear/SKILL.md first')
      expect(p).toContain('skill/lineclear-coordinator/SKILL.md')
      expect(p).not.toContain('lineclear-agent')
      expect(p).toContain(`Coordinator timer is ${mode === 'autopilot' ? 'on' : 'off'} now.`)
    }
    // a home space's also looks after its machine; the main machine's also keeps every machine's overview
    const home = coordinatorPrompt({ role: 'home', name: 'home', path: '/home/x', machine: 'mac' }, 'regular')
    expect(home).toContain("This is mac's home space: you also look after the machine")
    expect(home).not.toContain('every machine')
    const main = coordinatorPrompt({ role: 'main', name: 'home', path: '/home/x', machine: 'vm-str' }, 'regular')
    expect(main).toContain('This is the home space of the main machine, vm-str')
    expect(main).toContain('you keep the overview of every machine')
    expect(main).toContain('which alerts reach the phone')
    const rules = readFileSync(join(ROOT, 'skill', 'lineclear-coordinator', 'SKILL.md'), 'utf8')
    for (const w of ["Only on the human's plain word", 'standing requests', 'Coordinator timer', 'force-push', 'home space']) expect(rules).toContain(w)
  })
})

describe('projects', () => {
  test('task keys from project names', () => {
    expect(keyFor('gtm', [])).toBe('GTM')
    expect(keyFor('herdr-projects', [])).toBe('HP')
    expect(keyFor('lilla-varlden', [])).toBe('LV')
    expect(keyFor('herdr-plugins', ['HP'])).toBe('HERD')
  })

  test("this machine's shown name: a Mac's model, as herdr shows it; its HOST stays the key and is the fallback", () => {
    expect(machineName({}, 'darwin', () => 'Mac mini')).toBe('Mac mini')
    // a Mac that doesn't say, or can't be asked (no system_profiler here), and any other machine: its HOST
    expect(machineName({}, 'darwin', () => '')).toBe(HOST)
    expect(machineName({}, 'darwin')).toBe(HOST)
    expect(machineName({}, 'linux', () => 'Mac mini')).toBe(HOST)
    // run over SSH from the main machine: its herdr label
    expect(machineName({ LINECLEAR_MACHINE: HOST }, 'darwin', () => 'Mac mini')).toBe(HOST)
    // the place, its chat, mode and settings stay under the key
    expect(placeId.machine()).toBe(`m:${HOST}`)
  })
})

describe('interactive chat capabilities', () => {
  test('Settings offers runtime-readable kinds and rejects unsupported selections without changing defaults', async () => {
    const { CHAT_KINDS, readerFor } = await import('../server/live/readers/index.ts')
    const { LOG_FINDERS } = await import('../server/live/readers/find.ts')
    const { KIND, REVIEWERS } = await import('../server/live/settings.ts')
    const settings = new Settings({ everywhere: {}, machine: {}, spaces: {} })
    const legacy = new Settings({ everywhere: { 'task.agent': 'Antigravity' }, machine: {}, spaces: {} })
    expect(legacy.get('task.agent')).toBe('Antigravity')
    for (const key of ['task.agent', 'coordinator.agent', 'task.fallback']) {
      const row = CATALOG.flatMap((s) => s.rows).find((r) => r.key === key)!
      expect(row.options!.filter((v) => v !== 'off').map((v) => KIND[v])).toEqual(CHAT_KINDS)
      const before = settings.get(key)
      for (const value of ['Antigravity', 'Gemini', 'Cursor']) {
        expect(settings.set(key, value)).toMatchObject({ ok: false, error: expect.stringContaining('no chat log reader') })
        expect(settings.get(key)).toBe(before)
      }
    }
    for (const kind of CHAT_KINDS) {
      expect(readerFor(kind)).toBeDefined()
      expect(LOG_FINDERS[kind]).toBeFunction()
    }
    expect(settings.set('task.fallback', 'off').ok).toBe(true)
    expect(REVIEWERS).toEqual(['Codex', 'Claude Code', 'pi'])
  })

  test('unsupported starts and restarts fail before callbacks or agent state changes', async () => {
    const { Agents } = await import('../server/live/agents.ts')
    const agents = new Agents()
    const spec = { key: 'unsupported-chat', name: 'unsupported-chat', kind: 'agy', cwd: '/tmp', workspace: 'test' }
    let stopped = false
    await expect(agents.ensure(spec)).rejects.toThrow('no chat log reader')
    await expect(
      agents.restart(spec, async () => {
        stopped = true
      }),
    ).rejects.toThrow('no chat log reader')
    expect(stopped).toBe(false)
    expect(agents.record(spec.key)).toBeUndefined()
    agents.stop()
  })
})
