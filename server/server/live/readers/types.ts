// What pi's log file says, in the one shape the chat reads. It keeps only what the chat shows: what the human typed,
// the agent's replies, where a session starts and its errors.
import type { AgentRuntime } from '../../../shared/types.ts'

interface CliChoice {
  label: string
  description?: string
}
/** One question of a CLI's own question tool; allowCustom: a typed answer ("Other") is accepted. */
interface CliQuestionItem {
  header?: string
  question: string
  options: CliChoice[]
  multiSelect: boolean
  allowCustom: boolean
}

export type LogEvent =
  | { kind: 'runtime'; id: string; at: number; file: string; replace?: boolean; runtime: AgentRuntime }
  | { kind: 'session'; id: string; at: number; sessionId: string; file?: string }
  /** something the human (or Lineclear on their behalf) typed */
  | { kind: 'user'; id: string; at: number; text: string }
  /** a reply the agent wrote (markdown). Can come again with the same id and longer text: keep the latest per id. */
  | { kind: 'agent'; id: string; at: number; text: string }
  /** the CLI asks the human through its own question tool; id is the tool call id */
  | { kind: 'question'; id: string; at: number; tool: string; items: CliQuestionItem[] }
  | { kind: 'answered'; id: string; at: number }
  /** tokens one model call used; ids are unique per call, so they sum */
  | { kind: 'usage'; id: string; at: number; tokens: number }
  | { kind: 'turn-start'; id: string; at: number }
  | { kind: 'turn-end'; id: string; at: number }
  /** the model's provider cut the turn off: its words, and the CLI's own code and HTTP status where it has them */
  | { kind: 'error'; id: string; at: number; text: string; code?: string; status?: number }

/** Parses complete lines of a log file; ids stay stable across re-reads of the same file. */
export interface Reader {
  parse(lines: { text: string; offset: number }[], file: string): LogEvent[]
}
