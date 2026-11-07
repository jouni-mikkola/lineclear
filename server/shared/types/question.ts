/** A question card: built-in choice cards, a CLI's own menus, plans. */
interface Choice {
  label: string
  description?: string
}

export interface Question {
  id: string
  title: string
  kind: 'Form' | 'Question' | 'Plan'
  /** Explicitly an ordinary question, never permission or approval. Missing means confirm. */
  ordinary?: boolean
  steps?: string[]
  /** CLI prompt context, read from its visible screen. */
  screen?: string
  terminal?: boolean
  /** A terminal checkbox prompt can be declined without enabling any of its choices. */
  reject?: string
  choices: Choice[]
  multi?: boolean
  /** an "Other" answer with free text */
  other?: boolean
  /** which choice needs a note to be sent (a plan sent back) */
  noteRequiredFor?: number
  /** no note box at all */
  noNote?: boolean
  to: string
  /** index of the choice sent, once answered; -1 answered without a pick */
  sent?: number
  /** answered without a pick: the words it was answered with (an Other answer, or the message that answered it) */
  said?: string
  /** answered without a pick, and not on the card: by a message in the chat, or in the CLI's own terminal */
  via?: 'chat' | 'terminal'
  /** who asks, when it is not the agent's own message ("Claude Code asks") */
  asks?: string
  /** answered on its other copy (a task's question and its copy in its space's chat): where, and a link to that chat */
  elsewhere?: { label: string; chat: string; name: string }
}

/** A reply's quote of the message it answers */
export interface ReplyQuote {
  /** none when that message is no longer in the chat (only the quote is known) */
  id?: string
  who?: 'you' | 'agent'
  /** the start of its words, or a file's name */
  text: string
  file?: boolean
}

/** what a needs-you card asks, from its task's chat: its question cards, or the agent's plain question */
export interface CardAsk {
  /** the task's chat, where the answer goes */
  chat: string
  /** its question cards, as asked; on screen each as it stands in the task's chat */
  questions?: Question[]
  /** a plain question with no choices: the agent's words, answered with a reply */
  reply?: { id: string; text: string }
  /** once answered: where (in this card, in the task's chat or its terminal) and the words, if known */
  answered?: { where: 'space' | 'task' | 'terminal'; text?: string }
  /** on screen: it still waits, so it takes an answer here */
  open?: boolean
}
