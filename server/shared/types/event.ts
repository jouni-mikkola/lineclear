import type { Chat } from './chat.ts'
import type { Snapshot } from './snapshot.ts'

/** an agent's terminal as herdr draws it: its recent lines (ANSI), and the pane's size in cells (none from an older
 *  machine) */
export interface TermScreen {
  ansi: string
  cols?: number
  rows?: number
}

export type ServerEvent =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'chat'; chat: Chat }
  | ({ type: 'terminal'; chat: string } & TermScreen)
  | { type: 'offline'; since: number }
  /** the answer to a screen's ping: its link still works */
  | { type: 'pong' }
