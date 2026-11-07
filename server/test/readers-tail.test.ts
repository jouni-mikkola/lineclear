// The log tail, finding logs, token usage and turn marks (the readers' parsing is in readers.test.ts).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findPiLog, piSessionDir } from '../server/live/readers/find.ts'
import { LogTail, readerFor } from '../server/live/readers/index.ts'
import type { LogEvent } from '../server/live/readers/types.ts'
import { parse, brief, pimsg } from './readers-fixture.ts'

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
    expect(new LogTail(join(dir, 'none.jsonl'), readerFor('pi')!).read()).toEqual([])
  })
})

describe('finding logs', () => {
  const env = { ...process.env }
  afterAll(() => {
    for (const k of ['CODEX_HOME', 'PI_CODING_AGENT_DIR']) {
      if (env[k] === undefined) delete process.env[k]
      else process.env[k] = env[k]
    }
  })
  const touch = (f: string, text: string, mtimeMs: number) => {
    mkdirSync(join(f, '..'), { recursive: true })
    writeFileSync(f, text)
    utimesSync(f, mtimeMs / 1000, mtimeMs / 1000)
  }

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
