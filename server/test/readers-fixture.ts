import { readerFor } from '../server/live/readers/index.ts'
import type { LogEvent } from '../server/live/readers/types.ts'

export const parse = (cli: string, objs: object[]) =>
  readerFor(cli)!.parse(
    objs.map((o, i) => ({ text: JSON.stringify(o), offset: i * 1000 })),
    `/logs/${cli}.jsonl`,
  )

// token usage, turn starts and steps are checked on their own below; the other tests read the conversation
const STEPS = new Set(['step', 'step-end', 'job', 'job-end'])
export const brief = (ev: LogEvent[]) =>
  ev
    .filter((e) => e.kind !== 'runtime' && e.kind !== 'usage' && e.kind !== 'turn-start' && !STEPS.has(e.kind))
    .map((e) => (e.kind === 'user' || e.kind === 'agent' ? `${e.kind}:${e.text}` : e.kind === 'question' ? `question:${e.id}` : `${e.kind}:${e.id}`))

let n = 0
export const ts = () => `2026-10-24T10:00:${String(n++).padStart(2, '0')}.000Z`

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
