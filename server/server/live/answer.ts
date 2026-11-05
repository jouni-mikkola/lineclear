import type { Action } from '../../shared/types.ts'
import { placeId } from './places.ts'

/**
 * `lineclear answer`: answers a choice card of a space's coordinator chat in words, by the same path as a tap: the card
 * closes and its coordinator hears the answer. Only a rule, the Inbox or a coordinator does this, never a task's agent.
 */
export async function answerCard(
  act: (a: Action) => Promise<unknown>,
  from: string | undefined,
  space: string | undefined,
  id: string | undefined,
  text: string,
): Promise<string> {
  if (from?.includes('/')) throw new Error("A task's agent does not answer the coordinator's cards.")
  if (!space || !id) throw new Error('lineclear answer <card id> "<answer>" --space NAME')
  const r = (await act({ type: 'answer', chat: placeId.space(space), question: id, choice: -1, other: text.trim() || 'Answered.' })) as {
    ok?: boolean
    error?: string
  }
  // answered meanwhile (in the chat, or by the Inbox): nothing is left to do
  if (r.error && !/answered already/.test(r.error)) throw new Error(r.error)
  return `Answered ${id}.`
}
