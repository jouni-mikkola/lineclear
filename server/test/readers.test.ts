// The log readers, on made-up lines in each CLI's exact format (field names and nesting copied from real logs).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, brief, ts, pimsg } from './readers-fixture.ts'

describe('pi reader', () => {
  test('keeps user and assistant text; drops system, tool calls, results and thinking', () => {
    const ev = parse('pi', [
      { type: 'session', version: 3, id: 'sw-0001', timestamp: '2026-10-13T20:52:53.359Z', cwd: '/work/app' },
      { type: 'model_change', id: 'm1', parentId: null, timestamp: ts(), provider: 'openai', modelId: 'gpt' },
      { type: 'thinking_level_change', id: 'm2', parentId: 'm1', timestamp: ts(), thinkingLevel: 'high' },
      pimsg('e0', 'm2', { role: 'system', content: 'You are pi.', timestamp: 1 }),
      pimsg('e1', 'e0', { role: 'user', content: [{ type: 'text', text: 'List the files' }], timestamp: 2 }),
      pimsg('e2', 'e1', {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'use ls' },
          { type: 'toolCall', id: 'call_1', name: 'bash', arguments: { command: 'ls' } },
        ],
        api: 'openai-responses',
        provider: 'openai',
        model: 'gpt',
        usage: {},
        stopReason: 'toolUse',
        timestamp: 3,
      }),
      pimsg('e3', 'e2', {
        role: 'toolResult',
        toolCallId: 'call_1',
        toolName: 'bash',
        content: [{ type: 'text', text: 'a.ts' }],
        isError: false,
        timestamp: 4,
      }),
      pimsg('e4', 'e3', {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'answer' },
          { type: 'text', text: 'There is one file: a.ts' },
        ],
        api: 'openai-responses',
        provider: 'openai',
        model: 'gpt',
        usage: {},
        stopReason: 'stop',
        timestamp: 5,
      }),
      { type: 'custom', customType: 'some-extension', data: {}, id: 'c1', parentId: 'e4', timestamp: ts() },
      pimsg('e5', 'e4', {
        role: 'user',
        content: [{ type: 'text', text: '<skill name="review" location="/skills/review/SKILL.md">\nReview carefully.\n</skill>\n\nthe parser' }],
        timestamp: 6,
      }),
    ])
    expect(brief(ev)).toEqual([
      'session:session-sw-0001',
      'user:List the files',
      'agent:There is one file: a.ts',
      'turn-end:turn-e4',
      'user:/skill:review the parser',
    ])
    expect(ev[0]).toMatchObject({ sessionId: 'sw-0001' })
  })
})

/* ---------- LogTail and finding logs ---------- */

let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lineclear-readers-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})
