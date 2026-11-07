// What an agent does, calmly and in plain words: each step as what it did, a turn's steps as a few rows, the step it is
// on, its background work, and their output read only when opened. Words, rows and folding.
import { describe, expect, test } from 'bun:test'
import { glance, jobsWords, rowsOf, say, testResult, took } from '../shared/activity.ts'
import { activityOf, cutOutput, lineOf } from '../server/live/activity.ts'
import { claudeStep, commandSay, commandWords } from '../server/live/readers/steps.ts'
import type { Step } from '../shared/types.ts'
import type { LogEvent } from '../server/live/readers/types.ts'

describe('words', () => {
  test('an action said as a command reads done and doing; a word that is no verb stays', () => {
    expect(say('Check the task list')).toEqual({ title: 'Checked the task list', doing: 'Checking the task list' })
    expect(say('Run tests')).toEqual({ title: 'Ran tests', doing: 'Running tests' })
    expect(say('Clone the repo and find the log code')).toEqual({
      title: 'Cloned the repo and found the log code',
      doing: 'Cloning the repo and finding the log code',
    })
    expect(say('Stop the demo').title).toBe('Stopped the demo')
    expect(say('Copy files').title).toBe('Copied files')
    expect(say('TypeScript check')).toEqual({ title: 'TypeScript check', doing: 'TypeScript check' })
  })
  test('a command in words, never its command line: the agent’s description first, else what it runs', () => {
    const t = (command: string, description?: string) => claudeStep('Bash', { command, description })!
    expect(t('~/.lineclear/helper/bin/lineclear task list 2>&1 | grep -E "^SHE" | grep -vE "x"')).toMatchObject({
      step: 'run',
      title: 'Checked the task list',
      doing: 'Checking the task list',
    })
    expect(t('cd /w && git status').title).toBe('Checked git status')
    expect(t('bun run test changed')).toMatchObject({ title: 'Ran tests', test: true })
    expect(t('bun test webhook', 'Run the webhook tests')).toMatchObject({ title: 'Ran the webhook tests', test: true, detail: 'bun test webhook' })
    expect(t('rg -n "review" src')).toMatchObject({ step: 'search', title: 'Searched for “review”' })
    expect(t('sed -n 1,80p src/app.ts')).toMatchObject({ step: 'read', title: 'Read app.ts', target: 'app.ts' })
    expect(t('python3 - <<EOF\nprint(1)\nEOF').title).toBe('Ran a script')
    expect(t('frobnicate --all').title).toBe('Ran frobnicate')
    expect(t('bash -lc "git status"')).toMatchObject({ title: 'Checked git status', detail: 'bash -lc "git status"' })
    expect(t('python3 -c "print(123)"').title).toBe('Ran a script')
    expect(t('cat README.md | rg "bun test"').title).toBe('Read README.md')
    expect(commandSay('gh pr checks 48')).toMatchObject({ step: 'web', title: 'Checked the pull request’s checks' })
  })
  test('other tools in words: edits count their lines, searches quote, subagents say what they do', () => {
    expect(claudeStep('Edit', { file_path: '/w/src/a.ts', old_string: 'a\nb', new_string: 'a\nc\nd' })).toMatchObject({
      step: 'edit',
      title: 'Edited a.ts',
      target: 'a.ts',
      added: 2,
      removed: 1,
      detail: '/w/src/a.ts',
    })
    expect(claudeStep('Grep', { pattern: 'review' })).toMatchObject({ step: 'search', title: 'Searched the code for “review”' })
    expect(claudeStep('Read', { file_path: '/w/shot.png' })?.title).toBe('Looked at shot.png')
    expect(claudeStep('Agent', { description: 'Review the signature fix' })?.title).toBe('Asked a subagent to review the signature fix')
    expect(claudeStep('WebFetch', { url: 'https://example.com/docs' })?.title).toBe('Read example.com/docs')
    expect(claudeStep('mcp__github__get_pr', {})?.title).toBe('Used get pr')
    expect(claudeStep('AskUserQuestion', {})).toBeUndefined()
  })
  test('a test run’s outcome from its output', () => {
    expect(testResult(' 558 pass\n 0 fail\n')).toBe('558 passed')
    expect(testResult('Tests: 2 failed, 39 passed, 41 total')).toBe('2 failed, 39 passed')
    expect(testResult('===== 12 passed in 0.3s =====')).toBe('12 passed')
    expect(testResult('no counts here')).toBeUndefined()
  })
  test('a turn’s steps as rows: files read or changed in one row each; the rows that say most at a glance', () => {
    let i = 0
    const s = (said: ReturnType<typeof claudeStep>, x: Partial<Step> = {}): Step => {
      const { step, ...w } = said!
      return { id: `s${++i}`, kind: step, tool: 'x', at: i, end: i, ...w, ...x }
    }
    const steps = [
      s(claudeStep('Read', { file_path: '/w/a.ts' })),
      s(claudeStep('Bash', { command: 'lineclear task list' })),
      s(claudeStep('Read', { file_path: '/w/b.ts' })),
      s(claudeStep('Edit', { file_path: '/w/app.ts', old_string: 'x', new_string: 'y\nz' })),
      s(claudeStep('Edit', { file_path: '/w/panel.tsx', old_string: 'p', new_string: 'q' })),
      s(claudeStep('Edit', { file_path: '/w/app.ts', old_string: '', new_string: 'w' })),
      s(claudeStep('Bash', { command: 'bun test' }), { result: '41 passed' }),
      s(claudeStep('Bash', { command: 'lineclear task list' })),
    ]
    expect(rowsOf([s(claudeStep('Read', { file_path: '/w/src/index.ts' })), s(claudeStep('Read', { file_path: '/w/test/index.ts' }))])[0].text).toBe(
      'Read 2 files: index.ts, index.ts',
    )
    const rows = rowsOf(steps)
    expect(rows.map((r) => [r.kind, r.text, r.added, r.removed, r.steps.length])).toEqual([
      ['read', 'Read 2 files: a.ts, b.ts', undefined, undefined, 2],
      ['run', 'Checked the task list', undefined, undefined, 2],
      ['edit', 'Edited 2 files: app.ts, panel.tsx', 4, 2, 3],
      ['run', 'Ran tests: 41 passed', undefined, undefined, 1],
    ])
    const g = glance(rows)
    expect(g.more).toBe(1)
    expect(g.rows.map((r) => r.text)).toEqual(['Checked the task list', 'Edited 2 files: app.ts, panel.tsx', 'Ran tests: 41 passed'])
  })
  test('background work counted: agents work, shells run', () => {
    expect(jobsWords({ agent: 2 })).toBe('2 subagents working')
    expect(jobsWords({ agent: 1, headless: 1 })).toBe('2 subagents working')
    expect(jobsWords({ shell: 1 })).toBe('1 shell running')
    expect(jobsWords({ agent: 1, shell: 2 })).toBe('1 subagent · 2 shells')
  })
  test('times', () => {
    expect(took(42_000)).toBe('42s')
    expect(took(252_000)).toBe('4m 12s')
    expect(took(252_000, false)).toBe('4m')
    expect(took(3_780_000)).toBe('1h 3m')
  })
  test('a command without its cd into the worktree; output without colours, its last lines', () => {
    expect(commandWords('cd /w/x && bun test\nmore')).toBe('bun test')
    expect(commandWords("cd '/w/a b'; ls")).toBe('ls')
    const many = Array.from({ length: 450 }, (_, i) => `\x1b[32mline ${i}\x1b[0m`).join('\n')
    const c = cutOutput(many)
    expect(c.cut).toBe(true)
    expect(c.output.split('\n')).toHaveLength(400)
    expect(c.output.endsWith('line 449')).toBe(true)
  })
})

describe('folding', () => {
  const step = (id: string, at: number, x: Partial<Extract<LogEvent, { kind: 'step' }>> = {}): LogEvent => ({
    kind: 'step',
    id,
    at,
    step: 'run',
    tool: 'Bash',
    title: `Ran ${id}`,
    doing: `Running ${id}`,
    target: '',
    ...x,
  })
  test('steps fold by turn; a stand-in goes once over; the turn on now shows its step', () => {
    const { turns, open } = activityOf([
      { kind: 'turn-start', id: 't1', at: 0 },
      { kind: 'user', id: 'u1', at: 0, text: 'go' },
      step('s1', 1),
      { kind: 'step-end', id: 's1', at: 3, failed: true },
      step('s2', 4, { step: 'read' }),
      { kind: 'step-end', id: 's2', at: 5 },
      step('w', 6),
      { kind: 'step-end', id: 'w', at: 7, drop: true },
      { kind: 'agent', id: 'a1', at: 8, text: 'done' },
      { kind: 'turn-end', id: 'e1', at: 9 },
      { kind: 'turn-start', id: 't2', at: 10 },
      step('s3', 11, { step: 'edit', title: 'Edited a.ts', doing: 'Editing a.ts', target: 'a.ts' }),
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ id: 't1', at: 0, end: 9, asked: 'u1', reply: 'a1' })
    expect(lineOf(turns[0])).toMatchObject({
      id: 't1',
      at: 0,
      end: 9,
      steps: 2,
      failed: 1,
      now: undefined,
      rows: [{ text: 'Ran s1', failed: 1 }, { text: 'Ran s2' }],
    })
    expect(lineOf(open!, true)).toMatchObject({ id: 't2', end: undefined, steps: 1, now: { id: 's3', doing: 'Editing a.ts' } })
  })
  test('background work lasts until it says it is over, within its session', () => {
    const job = (id: string, at: number): LogEvent => ({ kind: 'job', id, at, job: 'shell', title: id, output: `/t/${id}.output` })
    expect(activityOf([job('a', 1), job('b', 2), { kind: 'job-end', id: 'a', at: 3 }]).jobs.map((j) => j.id)).toEqual(['b'])
    expect(activityOf([job('a', 1), { kind: 'session', id: 's', at: 2, sessionId: 'x' }]).jobs).toEqual([])
  })
})
