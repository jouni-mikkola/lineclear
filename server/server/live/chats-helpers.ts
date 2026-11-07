import type { Message } from '../../shared/types.ts'
import { stripHidden } from './agents.ts'
import { agentLines, markerSoFar, parseUserLine, type Parsed } from './chatlines.ts'
import type { LogEvent } from './readers/types.ts'
import type { Shown } from './chat-store.ts'

/** a chat line of yours that shows as words: an answer, a secret you gave */
export function shownAs(p: Parsed): { title?: string; text: string } | undefined {
  if (p.kind === 'answer') return { title: `Answered “${p.title}”`, text: p.answer }
  if (p.kind === 'secret') return { title: 'Gave a secret', text: `${p.name}${p.where ? `, for ${p.where}` : ''}` }
  return undefined
}

/** a line of yours the agent will answer: words of yours, not Lineclear's hidden news and not only reactions */
export const yours = (text: string) =>
  stripHidden(text)
    .split('\n')
    .some((ln) => ln.trim() && !['react', 'unreact'].includes(parseUserLine(ln.trim())?.kind ?? ''))

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

/** words as typed, whatever the spacing a CLI's log keeps */
export const words = (s: string) => s.replace(/\s+/g, ' ').trim()

/** the message each reply sent from a screen answers, by the words of its line: a quote alone may fit a newer message
    that starts the same way ("Done."). Kept until a restart; after one the quote finds it. */
export const replied = new Map<string, string>()

export function rememberReply(line: string, id: string) {
  replied.set(words(line), id)
  if (replied.size > 500) replied.delete(replied.keys().next().value!)
}

/** the agent's reply of the same turn, written at or after `at`, before you wrote again */
export function hostFor(msgs: Message[], at: number, p: { question?: unknown }): Message | undefined {
  for (const m of msgs) {
    if ((m.at ?? 0) < at - 1000) continue
    if (m.who === 'you') return undefined
    if (m.text && !m.card && !(p.question && m.question)) return m
  }
  return undefined
}

/** one more read of the screen: the reply counts once it grew since the last read and, past its reaction and reply
 *  lines, starts with two letters or more that aren't a hidden marker (<no-reply>, an older [[...]]), whole or still coming */
export function sawReply(s: Pick<Shown, 'last' | 'on'>, text: string | undefined): Pick<Shown, 'last' | 'on'> {
  const words = text === undefined ? '' : agentLines(text).text
  const ok = words.length >= 2 && !markerSoFar(words)
  return { on: s.on || (ok && s.last !== undefined && text !== s.last), last: ok ? text : undefined }
}

/** how much of a chat's logs one pull reads: the rest is read in the background a piece at a time, so a log of a
 *  hundred MB (a long-lived coordinator's) never holds up the server, at a restart or as it grows */
export const PIECE = 2 << 20
