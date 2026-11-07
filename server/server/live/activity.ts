// An agent's activity, from its log's events: each turn's steps (a few rows in plain words in the chat), the turn it is on now,
// and the work it started in the background that still runs. Raw output is read only when the human opens it, from
// where it is: a line of a log, a shell's output file.
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { glance, rowsOf } from '../../shared/activity.ts'
import type { Job, Step, TurnActivity } from '../../shared/types.ts'
import type { LogEvent, OutputAt } from './readers/types.ts'

export type StepRec = Step & { where?: OutputAt }

/** one turn: when it began and ended, its steps, and the messages that make it seen (what began it, its last reply) */
export interface Turn {
  id: string
  at: number
  end?: number
  steps: StepRec[]
  /** the last reply of the turn (an agent event's id): its rows sit just before it */
  reply?: string
  /** the human's message that began it (a user event's id) */
  asked?: string
}

/** background work from the log: what it is and where to read it */
export interface JobRec extends Job {
  output?: string
}

/** a turn as the chat draws it: the rows that say most, and the step on now while it runs */
export function lineOf(t: Turn, live = false): TurnActivity {
  const steps = t.steps.map(shown)
  const failed = steps.filter((s) => s.failed).length
  const now = live ? (t.steps.findLast((s) => !s.end) ?? t.steps.at(-1)) : undefined
  return {
    id: t.id,
    at: t.at,
    end: live ? undefined : t.end,
    ...glance(rowsOf(steps)),
    steps: steps.length,
    now: now && shown(now),
    failed: failed || undefined,
  }
}

/** a step as the screen gets it: where its output is stays here */
export const shown = ({ where, ...s }: StepRec): Step => ({ ...s, output: !!where || undefined })

/**
 * Turns and background work from a chat's events, in order. A turn starts at its turn-start (or its first step where a
 * CLI marks no turns) and ends at its turn-end, the next turn's start or a new session. A step-end with `drop` takes its
 * stand-in step away. Background work is what started and has not said it is over, in the session it runs in now.
 */
export function activityOf(ev: LogEvent[]): { turns: Turn[]; open?: Turn; jobs: JobRec[] } {
  const turns: Turn[] = []
  let cur: Turn | undefined
  const byId = new Map<string, { t: Turn; s: StepRec }>()
  const jobs = new Map<string, JobRec>()
  const close = (at?: number) => {
    if (!cur) return
    cur.end = at ?? Math.max(cur.at, ...cur.steps.map((s) => s.end ?? s.at))
    turns.push(cur)
    cur = undefined
  }
  for (const e of ev) {
    switch (e.kind) {
      case 'session':
        close()
        jobs.clear()
        break
      case 'turn-start':
        close(e.at)
        cur = { id: e.id, at: e.at, steps: [] }
        break
      case 'turn-end':
        if (cur) close(e.at)
        break
      case 'user':
        if (cur && !cur.asked && !cur.steps.length) cur.asked = e.id
        break
      case 'agent':
        if (cur) cur.reply = e.id
        break
      case 'step': {
        if (byId.has(e.id)) break
        cur ??= { id: `turn-${e.id}`, at: e.at, steps: [] }
        const { kind: _k, step, out, ...rest } = e
        const s: StepRec = { ...rest, kind: step, where: out }
        cur.steps.push(s)
        byId.set(e.id, { t: cur, s })
        break
      }
      case 'step-end': {
        const x = byId.get(e.id)
        if (!x) break
        if (e.drop) {
          x.t.steps.splice(x.t.steps.indexOf(x.s), 1)
          byId.delete(e.id)
        } else Object.assign(x.s, { end: e.at, failed: e.failed, where: e.out ?? x.s.where }, e.result ? { result: e.result } : {})
        break
      }
      case 'job':
        jobs.set(e.id, {
          id: e.id,
          kind: e.job,
          title: e.title,
          at: e.at,
          output: e.output,
          more: e.output ? 'output' : undefined,
        })
        break
      case 'job-end':
        jobs.delete(e.id)
        break
    }
  }
  return { turns, open: cur, jobs: [...jobs.values()] }
}

/* ---------- reading what was left in files ---------- */

const MAX_LINE = 8 << 20

/** the line of a file that starts at this offset */
function lineAt(file: string, offset: number): string | undefined {
  let fd: number
  try {
    fd = openSync(file, 'r')
  } catch {
    return undefined
  }
  try {
    const parts: Buffer[] = []
    let pos = offset
    let size = 0
    while (size < MAX_LINE) {
      const buf = Buffer.alloc(64 << 10)
      const got = readSync(fd, buf, 0, buf.length, pos)
      if (got <= 0) break
      const nl = buf.subarray(0, got).indexOf(10)
      parts.push(buf.subarray(0, nl < 0 ? got : nl))
      size += nl < 0 ? got : nl
      if (nl >= 0) break
      pos += got
    }
    return Buffer.concat(parts).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** the last bytes of a file, from a whole line on */
export function tailOf(file: string, bytes = 32 << 10): string | undefined {
  let fd: number
  try {
    const size = statSync(file).size
    fd = openSync(file, 'r')
    try {
      const from = Math.max(0, size - bytes)
      const buf = Buffer.alloc(size - from)
      const got = readSync(fd, buf, 0, buf.length, from)
      const text = buf.subarray(0, got).toString('utf8')
      return from ? text.slice(text.indexOf('\n') + 1) : text
    } finally {
      closeSync(fd)
    }
  } catch {
    return undefined
  }
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g

/** output as it reads: no colour codes, at most its last 400 lines */
export function cutOutput(text: string): { output: string; cut?: boolean } {
  const lines = text.replace(ANSI, '').replace(/\s+$/, '').split('\n')
  const cut = lines.length > 400
  let output = lines.slice(-400).join('\n')
  if (output.length > 40_000) output = output.slice(-40_000)
  return { output, cut: cut || output.length < text.length - 2000 || undefined }
}

/** the last line a shell printed, for a background job's line */
export function lastLine(file: string): string | undefined {
  const t = tailOf(file, 4096)
  const l = t
    ?.replace(ANSI, '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
    .at(-1)
  return l ? (l.length > 120 ? `${l.slice(0, 119)}…` : l) : undefined
}

type Json = any

const textOf = (c: Json): string =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c
          .map((b: Json) => (typeof b === 'string' ? b : b?.type === 'text' || b?.type === 'input_text' ? (b.text ?? '') : ''))
          .filter(Boolean)
          .join('\n')
      : ''

/** an edit's change as a diff, from Claude Code's record of it: its hunks, or a new file's lines */
function diffOf(r: Json): string | undefined {
  if (Array.isArray(r?.structuredPatch) && r.structuredPatch.length)
    return r.structuredPatch
      .map((h: Json) => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...(Array.isArray(h.lines) ? h.lines : [])].join('\n'))
      .join('\n')
  if (r?.type === 'create' && typeof r.content === 'string')
    return r.content
      .split('\n')
      .map((x: string) => `+${x}`)
      .join('\n')
  return undefined
}

/** a step's raw output, from the log line that holds it: Claude Code's tool result, Codex's item or call output */
export function outputAt(where: OutputAt, id: string): string | undefined {
  const raw = lineAt(where.file, where.offset)
  if (!raw) return undefined
  let l: Json
  try {
    l = JSON.parse(raw)
  } catch {
    return undefined
  }
  // Claude Code: the result of that tool call
  const blocks: Json[] = Array.isArray(l?.message?.content) ? l.message.content : []
  const r = blocks.find((b) => b?.type === 'tool_result' && b.tool_use_id === id)
  if (r) return diffOf(l.toolUseResult) ?? textOf(r.content)
  // Codex: the item, or the call's output
  const p = l?.payload
  const it = p?.item
  if (it?.type === 'CommandExecution') return String(it.aggregated_output ?? '')
  if (it?.type === 'FileChange')
    return Object.entries(it.changes ?? {})
      .map(([f, c]: [string, Json]) => `${f}\n${c?.unified_diff ?? c?.content ?? ''}`)
      .join('\n\n')
  if (it?.type === 'McpToolCall') return textOf(it.result?.content) || JSON.stringify(it.result ?? '', null, 1)
  if (it) return JSON.stringify(it, null, 1)
  if (p?.output !== undefined) return typeof p.output === 'string' ? p.output : textOf(p.output)
  return undefined
}
