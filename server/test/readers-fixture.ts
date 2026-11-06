import { readerFor } from '../server/live/readers/index.ts'
import type { LogEvent } from '../server/live/readers/types.ts'

export const parse = (cli: string, objs: object[]) =>
  readerFor(cli)!.parse(
    objs.map((o, i) => ({ text: JSON.stringify(o), offset: i * 1000 })),
    `/logs/${cli}.jsonl`,
  )

// token usage, turn starts and steps are checked on their own below; the other tests read the conversation
export const STEPS = new Set(['step', 'step-end', 'job', 'job-end'])
export const brief = (ev: LogEvent[]) =>
  ev
    .filter((e) => e.kind !== 'runtime' && e.kind !== 'usage' && e.kind !== 'turn-start' && !STEPS.has(e.kind))
    .map((e) => (e.kind === 'user' || e.kind === 'agent' ? `${e.kind}:${e.text}` : e.kind === 'question' ? `question:${e.id}` : `${e.kind}:${e.id}`))

/* ---------- Claude Code ---------- */

export const S = 'b1f0c2d4-0000-4000-8000-000000000001'
export const base = { isSidechain: false, userType: 'external', entrypoint: 'cli', cwd: '/work/app', sessionId: S, version: '2.1.283', gitBranch: 'main' }
let n = 0
export const ts = () => `2026-10-24T10:00:${String(n++).padStart(2, '0')}.000Z`
export const cuser = (uuid: string, content: unknown, extra: object = {}) => ({
  parentUuid: null,
  ...base,
  promptId: 'p-1',
  type: 'user',
  message: { role: 'user', content },
  uuid,
  timestamp: ts(),
  ...extra,
})
export const typed = { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' }
export const cassistant = (uuid: string, id: string, block: object, stop: string | null) => ({
  parentUuid: null,
  ...base,
  message: {
    model: 'claude-opus-5-5',
    id,
    type: 'message',
    role: 'assistant',
    content: [block],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  },
  requestId: 'req_1',
  type: 'assistant',
  uuid,
  timestamp: ts(),
})
export const toolResult = (uuid: string, id: string, content: string) =>
  cuser(uuid, [{ tool_use_id: id, type: 'tool_result', content }], { toolUseResult: { stdout: content }, sourceToolAssistantUUID: 'x' })

export const T = '01a172ce-0000-7000-8000-000000000002'
const line = (type: string, payload: object) => ({ timestamp: ts(), type, payload })
const meta = (kinds: string[]) => ({ turn_id: 'turn-1', create_time: 1792927517.06, content_item_kinds: kinds })
export const cxmsg = (id: string, role: string, content: object[], kinds?: string[]) =>
  line('response_item', { type: 'message', id, role, content, internal_chat_message_metadata_passthrough: kinds ? meta(kinds) : { turn_id: 'turn-1' } })
export const sessionMeta = (cwd: string, extra: object = {}) =>
  line('session_meta', {
    session_id: T,
    id: T,
    timestamp: '2026-10-25T11:25:12.070Z',
    cwd,
    originator: 'codex-tui',
    cli_version: '0.163.0',
    source: 'cli',
    thread_source: 'user',
    model_provider: 'openai',
    base_instructions: { text: 'You are Codex.' },
    ...extra,
  })

export const pimsg = (id: string, parentId: string | null, message: object) => ({ type: 'message', id, parentId, timestamp: ts(), message })
