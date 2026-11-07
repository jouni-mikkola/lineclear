import { stripHidden } from './agents.ts'
import { agentLines } from './agentlines.ts'
import type { LogEvent } from './readers/types.ts'

/** a line of yours the agent will answer: words of yours, not Lineclear's hidden news and */
export const yours = (text: string) => !!stripHidden(text)

/** The turn the agent is in, by its log: one your message started ('yours'), one it started itself on Lineclear's news,
 *  its background work waking it ('own', with that turn's id), or none ('over': its reply ended the
 *  last one, and what herdr still sees working is background work: a subagent, a shell). No turn marks: 'unknown'. */
export function turnOf(ev: LogEvent[], sent: { at: number }[]): { kind: 'yours' | 'own' | 'over' | 'unknown'; id?: string } {
  if (!ev.some((e) => e.kind === 'turn-start' || e.kind === 'turn-end')) return { kind: 'unknown' }
  const end = ev.findLastIndex((e) => e.kind === 'turn-end')
  // what you sent from a screen since the last turn ended went in before the CLI wrote it down: its turn is on its way
  if (sent.some((o) => o.at > (end < 0 ? -Infinity : ev[end].at))) return { kind: 'yours' }
  const now = ev.slice(end + 1)
  const start = now.find((e) => e.kind === 'turn-start')
  if (!start) return { kind: 'over' }
  // yours once a message of yours is in it, even one taken in mid-turn
  return now.some((e) => e.kind === 'user' && yours(e.text)) ? { kind: 'yours' } : { kind: 'own', id: start.id }
}

/** a reply you will see that already landed in the agent's own turn (a hidden <no-reply> is none) */
const landed = (ev: LogEvent[]) => {
  const start = ev.findLastIndex((e) => e.kind === 'turn-start')
  return start >= 0 && ev.slice(start).some((e) => e.kind === 'agent' && agentLines(stripHidden(e.text)).text)
}

/** Do the typing dots show: is a message you will see on its way? In a turn you started, at once (an agent never
 *  answers you with a hidden <no-reply>). In one it started itself, only once its reply shows: on its screen as it
 *  streams (`shown`) or landed in its log; until then it may be thinking, running tools, or about to say <no-reply>. */
export function replying(turn: ReturnType<typeof turnOf>, shown: boolean, ev: LogEvent[]): boolean {
  if (turn.kind === 'yours' || turn.kind === 'unknown') return true
  return turn.kind === 'own' && (shown || landed(ev))
}

/** what the screen showed of the reply in a turn the agent started itself */
export interface Shown {
  turn: string
  /** the reply's text at the last read; it must grow once before it counts, so a still line (a job's "completed") never does */
  last?: string
  on: boolean
  at: number
}
