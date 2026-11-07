import type { Message, Question, SecretAsk, UpdateCard } from '../../shared/types.ts'
import { agentLines, markerSoFar, type Parsed } from './chatlines.ts'
import type { Shown } from './chats-turns.ts'

/** a chat line of yours that shows as words: an answer, a secret you gave */
export function shownAs(p: Parsed): { title?: string; text: string } | undefined {
  if (p.kind === 'answer') return { title: `Answered “${p.title}”`, text: p.answer }
  if (p.kind === 'secret') return { title: 'Gave a secret', text: `${p.name}${p.where ? `, for ${p.where}` : ''}` }
  return undefined
}

/** something Lineclear posted into a chat */
export interface Posted {
  id: string
  at: number
  card?: UpdateCard
  question?: Question
  /** a secret the agent asked for: its masked box */
  secret?: SecretAsk
  /** text shown with it, when it stands alone */
  text?: string
  /** a line of yours Lineclear shows for you (an answer typed as keys, or a command, which the log doesn't keep) */
  who?: 'you'
  answered?: string
  /** answered on the question's copy in a space's chat: a link there */
  elsewhere?: Question['elsewhere']
  /** the screen's own id for it: the log's line, when it has one after all, shows instead */
  cid?: string
}

export interface ChatLog {
  posted: Posted[]
  /** the choice you sent for each question, by question id */
  answers: Record<string, number>
  /** the words a question was answered with instead of a pick, by question id; chat: a message in the chat; space: on
   *  its copy in that space's chat */
  said?: Record<string, { text?: string; chat?: true; space?: string }>
}

/** a card Lineclear posted, with its answer: a choice card answered without a pick and no words typed on it was
 *  answered by a message in the chat (closeAsks; older logs kept no words) */
export function withAnswer(q: Question, l: ChatLog, place: (key: string) => Question['elsewhere']): Question {
  const sent = q.sent ?? l.answers[q.id]
  const s = l.said?.[q.id]
  const elsewhere = s?.space ? place(s.space) : undefined
  if (sent !== -1) return { ...q, sent, elsewhere }
  return { ...q, sent, said: s?.text, via: s?.chat || (!s && q.id.startsWith('ask:')) ? 'chat' : undefined, elsewhere }
}

export const safe = (key: string) => key.replace(/[^a-zA-Z0-9_.-]+/g, '_')

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
