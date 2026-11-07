import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Task } from '../../shared/types.ts'
import type { Parsed } from './args.ts'

/** how long one line of another space's news may be for the main machine's home space */
export const OVERVIEW_MAX = 240

/** how a coordinator answers news the human sees as a card: the card is never the chat's last word */
export const REPLY_AFTER_CARD =
  'reply after it in one or two short lines of plain words: what it means here, what comes next, and whether the human needs to know or do anything (“Letter garden is live. TG-30 starts next, nothing needed from you.”). Never <no-reply> to it.'

/** what a task holds, in words for the screen without its path: "uncommitted changes" */
export const heldWords = (h: string) => /\(([^)]*)\)$/.exec(h)?.[1] ?? h

/** a time left as minutes: "5m", "5 min", "90", "1h", "1h20m", "1.5h"; null when it is none of those */
export function minutesOf(text: string): number | null {
  const m = text
    .trim()
    .toLowerCase()
    .match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*(?:m|mins?|minutes?)?)?$/)
  if (!m || (m[1] === undefined && m[2] === undefined)) return null
  return Math.round(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0))
}

/** a task's line in the CLI, as on screen: its agent's own line while it works, else its standard status line (never the brief) */
export function statusLine(t: Task) {
  return t.status === 'work' && t.report && !t.report.paused ? t.report.msg : t.sub
}

/** a chat's own folder in the inbox: never "." or "..", so it can't lead out of it */
export function chatDir(chat: string) {
  return chat.replace(/[^a-zA-Z0-9_.-]+/g, '_').replace(/^\.+/, '_')
}

/** a worker's lineclear command run by the main machine's Lineclear, as the main machine's own */
export async function mainCli(args: string[]): Promise<{ out: string; code: number }> {
  try {
    const { port } = JSON.parse(readFileSync(join(process.env.LINECLEAR_MAIN_HOME ?? '', 'server.json'), 'utf8')) as { port: number }
    const r = await fetch(`http://127.0.0.1:${port}/api/cli`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args }),
    })
    return (await r.json()) as { out: string; code: number }
  } catch {
    return { out: "The main machine's Lineclear can't be reached right now (it may be restarting): try again in a minute.", code: 1 }
  }
}

/** a worker's Everywhere defaults: the main machine's settings file, as it is now */
export function sharedEverywhere(): Record<string, string> | null {
  const dir = process.env.LINECLEAR_SHARED_HOME
  if (!dir) return null
  try {
    return (JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { everywhere?: Record<string, string> }).everywhere ?? null
  } catch {
    return null
  }
}

/** Preserve all task options when a helper asks for a task on another machine. */
export function taskAddArgs(rest: string[], p: Parsed, space?: string): string[] {
  return [
    'task',
    'add',
    ...rest,
    ...Object.entries(p.opts).flatMap(([key, values]) => (key === 'space' && space ? [space] : values).flatMap((value) => [`--${key}`, value])),
    ...[...p.flags].map((key) => `--${key}`),
  ]
}
