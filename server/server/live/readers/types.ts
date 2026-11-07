// What pi's log file says, in the shape the chat reads. Readers keep only what the chat shows.
import type { AgentRuntime } from '../../../shared/types.ts'

interface CliChoice {
  label: string
  description?: string
}

/** One question of a CLI's own question tool. */
interface CliQuestionItem {
  header?: string
  question: string
  options: CliChoice[]
  multiSelect: boolean
  /** the CLI accepts a typed answer ("Other") */
  allowCustom: boolean
}

export type LogEvent =
  | { kind: 'runtime'; id: string; at: number; file: string; replace?: boolean; runtime: AgentRuntime }

  /** a new log file (session) starts */
  | { kind: 'session'; id: string; at: number; sessionId: string; file?: string }
  /** something the human (or Lineclear on their behalf) typed */
  | { kind: 'user'; id: string; at: number; text: string }
  /** a reply the agent wrote (markdown). Can come again with the same id and longer text when the CLI writes the rest
   * of that reply after a read: keep the latest per id. */
  | { kind: 'agent'; id: string; at: number; text: string }
  /** the CLI asks the human through its own question tool; id is the tool call id */
  | { kind: 'question'; id: string; at: number; tool: string; items: CliQuestionItem[] }
  /** the question with this tool call id got its answer */
  | { kind: 'answered'; id: string; at: number }
  /** tokens one model call used (input, cached input and output together); ids are unique per call, so they sum */
  | { kind: 'usage'; id: string; at: number; tokens: number }
  /** the agent's turn began */
  | { kind: 'turn-start'; id: string; at: number }
  /** the agent's turn ended (the CLI wrote its end-of-turn marker) */
  | { kind: 'turn-end'; id: string; at: number }
  /** the model's provider cut the turn off: its words, and the CLI's own code and HTTP status for it where it has them */
  | { kind: 'error'; id: string; at: number; text: string; code?: string; status?: number }

export interface Reader {
  /** herdr's agent kind this reader is for */
  cli: string
  /**
   * Parses complete lines of a log file. `lines` never has a partial last line; ids stay stable across re-reads.
   */
  parse(lines: { text: string; offset: number }[], file: string): LogEvent[]
  /** forget what was read of this file (it was truncated or replaced) */
  reset?(file: string): void
}
