// Picks the reader for a CLI.
import { PiReader } from './pi.ts'
import type { Reader } from './types.ts'

const READERS: Record<string, () => Reader> = {
  pi: () => new PiReader(),
}

/** Kinds with a transcript reader. */
export const CHAT_KINDS = Object.keys(READERS)

export function chatProblem(kind: string): string | undefined {
  if (!CHAT_KINDS.includes(kind)) return `${kind} does not support Lineclear chat: no chat log reader is available. Choose ${CHAT_KINDS.join(', ')}.`
}

/** a fresh reader for herdr's agent kind (readers remember open questions and split replies per file) */
export function readerFor(cli: string): Reader | undefined {
  const kind = cli.toLowerCase()
  return Object.hasOwn(READERS, kind) ? READERS[kind]() : undefined
}
