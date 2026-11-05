// lineclear answer: a coordinator chat's card answered in words by a rule or the Inbox, never by a task's agent.
import { expect, test } from 'bun:test'
import type { Action } from '../shared/types.ts'
import { answerCard } from '../server/live/answer.ts'

test("the answer goes in as the same action a tap sends, in the space's chat", async () => {
  const sent: Action[] = []
  const act = async (a: Action) => {
    sent.push(a)
    return { ok: true }
  }
  expect(await answerCard(act, undefined, 'lineclear', 'ask:1', 'Go on.')).toBe('Answered ask:1.')
  expect(sent).toMatchObject([{ type: 'answer', question: 'ask:1', choice: -1, other: 'Go on.' }])
  expect((sent[0] as { chat: string }).chat).toContain('lineclear')
})

test("a task's agent, a missing space or card, and a refused answer are errors", async () => {
  const act = async () => ({ ok: false, error: 'This card is answered already.' })
  await expect(answerCard(act, 'LIN-1/Agent', 'lineclear', 'ask:1', 'x')).rejects.toThrow('does not answer')
  await expect(answerCard(act, undefined, undefined, 'ask:1', 'x')).rejects.toThrow('lineclear answer')
  await expect(answerCard(act, undefined, 'lineclear', undefined, 'x')).rejects.toThrow('lineclear answer')
  expect(await answerCard(act, undefined, 'lineclear', 'ask:1', 'x')).toBe('Answered ask:1.')
  const broken = async () => ({ ok: false, error: 'No chat.' })
  await expect(answerCard(broken, undefined, 'lineclear', 'ask:1', 'x')).rejects.toThrow('No chat.')
})
