import type { Question, ReplyQuote } from './question.ts'
import type { UpdateCard } from './card.ts'

/** a secret an agent asked for by name: the human types or pastes it in a masked box, for one of the levels offered;
 *  only its name ever shows, never its value */
export interface SecretAsk {
  id: string
  name: string
  /** why the agent needs it, in its words */
  why?: string
  /** where it may be kept, the agent's space first: a level's id (p:<machine>:<space>, m:<machine>, all) and its name */
  levels: { id: string; label: string }[]
  /** saved: where, by its level's name */
  saved?: string
}

export interface Message {
  id: string
  who: 'you' | 'agent'
  /** plain text (yours) or markdown (the agent's) */
  text?: string
  /** "Answered “Rerun CI on main?”" */
  answered?: string
  /** answered on the question's copy in a space's chat: a link there */
  elsewhere?: Question['elsewhere']
  question?: Question
  /** waits to go in: the agent shows a menu or permission prompt, or is still starting (a busy one takes it at once) */
  waiting?: boolean
  /** why it waits: a menu is up (typed text could pick an option), the agent is starting, or a CLI command waits for the
   *  turn to end */
  waitsFor?: 'menu' | 'start' | 'turn'
  /** an attached file: each one is a message of its own, right after the text it came with */
  file?: { name: string; path: string }
  /** the id the screen gave what you sent: it showed it at once, and this message takes its place */
  cid?: string
  /** what it answers: a short quote of that message, and its id while the chat still has it (a tap jumps to it) */
  reply?: ReplyQuote
  /** a thin "New session" divider before this message */
  newSession?: boolean
  /** Lineclear's update card about a task, drawn as the card; its text ("SHE-4 is done: …") is what a reply quotes */
  card?: UpdateCard
  /** a secret the agent asked for (lineclear secret ask): a masked box to give it in */
  secret?: SecretAsk
  at?: number
}

/** an update card as a message in the chat: its words are what a reply quotes */
export const cardMessage = (card: UpdateCard, at?: number): Message => ({
  id: card.id,
  who: 'agent',
  at,
  text: `${card.task ?? card.health?.machine ?? card.red ?? ''} ${card.text}`,
  card,
})
