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

export const pimsg = (id: string, parentId: string | null, message: object) => ({ type: 'message', id, parentId, timestamp: ts(), message })
