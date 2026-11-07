import type { Question, SecretAsk, UpdateCard } from '../../shared/types.ts'

/** what the screen showed of the reply in a turn the agent started itself */
export interface Shown {
  turn: string
  /** the reply's text at the last read; it must grow once before it counts, so a still line (a job's "completed") never does */
  last?: string
  on: boolean
  at: number
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
