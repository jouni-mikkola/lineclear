// The log tail, finding logs, token usage and turn marks (the readers' parsing is in readers.test.ts).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeLogPath, findClaudeLog, findCodexLog, findPiLog, piSessionDir } from '../server/live/readers/find.ts'
import { LogTail, readerFor } from '../server/live/readers/index.ts'
import type { LogEvent } from '../server/live/readers/types.ts'
import { parse, brief, base, ts, cuser, typed, cassistant, toolResult, cxmsg, sessionMeta, pimsg, T } from './readers-fixture.ts'

let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lineclear-readers-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})
const jl = (o: object) => `${JSON.stringify(o)}\n`
const piSession = (id: string) => jl({ type: 'session', version: 3, id, timestamp: '2026-10-13T20:52:53.359Z', cwd: '/w' })
const piUser = (id: string, text: string) => jl(pimsg(id, null, { role: 'user', content: [{ type: 'text', text }], timestamp: 1 }))

describe('LogTail', () => {
  test('reads only new lines, holding a partial last line until it is complete', () => {
    const f = join(dir, 'tail.jsonl')
    const third = piUser('e2', 'third')
    writeFileSync(f, piSession('s1') + piUser('e1', 'first') + third.slice(0, 20))
    const tail = new LogTail(f, readerFor('pi')!)
    expect(brief(tail.read())).toEqual(['session:session-s1', 'user:first'])
    expect(tail.read()).toEqual([])
    appendFileSync(f, third.slice(20))
    expect(brief(tail.read())).toEqual(['user:third'])
    expect(brief(tail.readAll())).toEqual(['session:session-s1', 'user:first', 'user:third'])
    appendFileSync(f, piUser('e3', 'fourth'))
    expect(brief(tail.read())).toEqual(['user:fourth'])
  })

  test('starts over when the file is truncated or replaced', () => {
    const f = join(dir, 'trunc.jsonl')
    writeFileSync(f, piSession('s1') + piUser('e1', 'a long first prompt'))
    const tail = new LogTail(f, readerFor('pi')!)
    expect(brief(tail.read())).toHaveLength(2)
    writeFileSync(f, piSession('s2'))
    expect(brief(tail.read())).toEqual(['session:session-s2'])
    const g = join(dir, 'trunc.new')
    writeFileSync(g, piSession('s3') + piUser('e1', 'x') + piUser('e2', 'y'))
    renameSync(g, f)
    expect(brief(tail.read())).toEqual(['session:session-s3', 'user:x', 'user:y'])
  })

  test('a read with a limit stops after whole lines past it; the next goes on, and a partial last line is not more to read', () => {
    const f = join(dir, 'limit.jsonl')
    const lines = Array.from({ length: 400 }, (_, i) => piUser(`e${i}`, `prompt ${i} ${'x'.repeat(1000)}`))
    const last = piUser('e400', 'not yet whole')
    writeFileSync(f, piSession('s1') + lines.join('') + last.slice(0, 30))
    const tail = new LogTail(f, readerFor('pi')!)
    const got: string[] = []
    let reads = 0
    do {
      const ev = brief(tail.read(64 << 10))
      expect(ev.length).toBeLessThan(401)
      got.push(...ev)
      reads++
    } while (tail.behind)
    expect(reads).toBeGreaterThan(3)
    expect(got).toEqual(brief(new LogTail(f, readerFor('pi')!).read()))
    expect(got).toHaveLength(401)
    expect(tail.read(64 << 10)).toEqual([])
    appendFileSync(f, last.slice(30))
    expect(brief(tail.read(64 << 10))).toEqual(['user:not yet whole'])
  })

  test('a missing file reads as nothing', () => {
    expect(new LogTail(join(dir, 'none.jsonl'), readerFor('claude')!).read()).toEqual([])
  })
})

describe('finding logs', () => {
  const env = { ...process.env }
  afterAll(() => {
    for (const k of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'PI_CODING_AGENT_DIR']) {
      if (env[k] === undefined) delete process.env[k]
      else process.env[k] = env[k]
    }
  })
  const touch = (f: string, text: string, mtimeMs: number) => {
    mkdirSync(join(f, '..'), { recursive: true })
    writeFileSync(f, text)
    utimesSync(f, mtimeMs / 1000, mtimeMs / 1000)
  }

  test('claude: project folder from the cwd, newest session after a time', () => {
    process.env.CLAUDE_CONFIG_DIR = join(dir, 'claude')
    const cwd = '/home/me/.herdr/work_1'
    expect(claudeLogPath(cwd, 'abc')).toBe(join(dir, 'claude', 'projects', '-home-me--herdr-work-1', 'abc.jsonl'))
    const now = Date.now()
    touch(claudeLogPath(cwd, 'old'), '', now - 60_000)
    touch(claudeLogPath(cwd, 'new'), '', now - 1000)
    expect(findClaudeLog(cwd)).toBe(claudeLogPath(cwd, 'new'))
    expect(findClaudeLog(cwd, now)).toBeUndefined()
    expect(findClaudeLog('/nowhere')).toBeUndefined()
  })

  test("codex: today's rollout whose session_meta has the cwd, not a subagent's", () => {
    process.env.CODEX_HOME = join(dir, 'codex')
    const d = new Date()
    const day = join(dir, 'codex', 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
    const now = Date.now()
    touch(join(day, 'rollout-a.jsonl'), jl(sessionMeta('/work/app')) + jl(cxmsg('m', 'user', [])), now - 5000)
    touch(join(day, 'rollout-b.jsonl'), jl(sessionMeta('/work/other')), now - 1000)
    touch(
      join(day, 'rollout-c.jsonl'),
      jl(sessionMeta('/work/app', { source: { subagent: { thread_spawn: { parent_thread_id: T } } }, thread_source: 'subagent' })),
      now - 500,
    )
    expect(findCodexLog('/work/app')).toBe(join(day, 'rollout-a.jsonl'))
    expect(findCodexLog('/work/app/')).toBe(join(day, 'rollout-a.jsonl'))
    expect(findCodexLog('/work/app', now)).toBeUndefined()
  })

  test('pi: session folder from the cwd', () => {
    process.env.PI_CODING_AGENT_DIR = join(dir, 'pi')
    const cwd = '/home/me/.herdr/work-1'
    expect(piSessionDir(cwd)).toBe(join(dir, 'pi', 'sessions', '--home-me-.herdr-work-1--'))
    const now = Date.now()
    touch(join(piSessionDir(cwd), '2026-10-13T20-52-53-359Z_a.jsonl'), piSession('a'), now - 9000)
    touch(join(piSessionDir(cwd), '2026-10-13T21-00-00-000Z_b.jsonl'), piSession('b'), now - 2000)
    expect(findPiLog(cwd)).toBe(join(piSessionDir(cwd), '2026-10-13T21-00-00-000Z_b.jsonl'))
    expect(findPiLog(cwd, now)).toBeUndefined()
  })
})

describe('token usage', () => {
  test('Claude Code: once per reply, all input and output', () => {
    const ev = parse('claude', [
      {
        type: 'assistant',
        sessionId: 's1',
        uuid: 'x1',
        timestamp: '2026-10-25T10:00:00.000Z',
        message: {
          id: 'msg_U',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 7 },
        },
      },
    ])
    const u = ev.filter((e) => e.kind === 'usage')
    expect(u).toHaveLength(1)
    expect(u[0]).toMatchObject({ id: 'usage-msg_U', tokens: 122 })
  })
  test('pi: each reply from its usage', () => {
    const ev = parse('pi', [
      {
        type: 'message',
        id: 'm1',
        timestamp: '2026-10-25T10:00:00.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hi' }], stopReason: 'stop', usage: { totalTokens: 42 } },
      },
    ])
    expect(ev.find((e) => e.kind === 'usage')).toMatchObject({ tokens: 42 })
  })
})

describe('turn marks', () => {
  const turns = (ev: LogEvent[]) => ev.filter((e) => e.kind === 'turn-start' || e.kind === 'turn-end').map((e) => e.kind)

  test('Claude Code: your prompt starts a turn, its reply ends it; a finished background job wakes it into a new one', () => {
    const ev = parse('claude', [
      cuser('u1', 'Research four options', typed),
      cassistant('a1', 'msg_T1', { type: 'tool_use', id: 'toolu_B', name: 'Agent', input: { run_in_background: true } }, 'tool_use'),
      toolResult('u2', 'toolu_B', 'Started in the background.'),
      cassistant('a2', 'msg_T2', { type: 'text', text: 'Research is running.' }, 'end_turn'),
      { ...base, type: 'system', subtype: 'turn_duration', durationMs: 1000, uuid: 's1', timestamp: ts() },
      // the subagent's own lines never start or end anything
      { ...cassistant('a3', 'msg_side', { type: 'text', text: 'Searching.' }, 'end_turn'), isSidechain: true },
      cuser('u3', '<task-notification>\n<task-id>abc</task-id>\n</task-notification>', { origin: { kind: 'task-notification', producer: 'session-task' } }),
      cassistant('a4', 'msg_T3', { type: 'text', text: '1 of 4 in.' }, 'end_turn'),
      { ...base, type: 'system', subtype: 'turn_duration', durationMs: 1000, uuid: 's2', timestamp: ts() },
    ])
    expect(turns(ev)).toEqual(['turn-start', 'turn-end', 'turn-start', 'turn-end'])
    expect(brief(ev).filter((e) => e.startsWith('agent:'))).toEqual(['agent:Research is running.', 'agent:1 of 4 in.'])
  })

  test('Claude Code: a reply that starts without a prompt starts a turn too', () => {
    const ev = parse('claude', [cassistant('a1', 'msg_W', { type: 'tool_use', id: 't', name: 'Bash', input: {} }, 'tool_use')])
    expect(turns(ev)).toEqual(['turn-start'])
  })

  test("pi: each prompt and the reply's stop, and a retry after an error", () => {
    const pi = parse('pi', [
      pimsg('e1', null, { role: 'user', content: [{ type: 'text', text: 'List the files' }], timestamp: 2 }),
      pimsg('e2', 'e1', { role: 'assistant', content: [{ type: 'text', text: 'One file.' }], usage: {}, stopReason: 'stop', timestamp: 3 }),
    ])
    expect(turns(pi)).toEqual(['turn-start', 'turn-end'])
    // pi retries a failed call on its own: the error ends that turn, the retry starts one, so none stays open if it gives up
    const retry = parse('pi', [
      pimsg('e1', null, { role: 'user', content: [{ type: 'text', text: 'List the files' }], timestamp: 2 }),
      pimsg('e2', 'e1', { role: 'assistant', content: [], usage: {}, stopReason: 'error', timestamp: 3 }),
      pimsg('e3', 'e2', { role: 'assistant', content: [{ type: 'text', text: 'One file.' }], usage: {}, stopReason: 'stop', timestamp: 4 }),
    ])
    expect(turns(retry)).toEqual(['turn-start', 'turn-end', 'turn-start', 'turn-end'])
  })
})
