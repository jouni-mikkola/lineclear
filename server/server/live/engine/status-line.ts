// A task's status line: an agent's own words, or its last question, cut to fit.
import { STATUS_MAX } from '../../../shared/types/task.ts'

/** A status line cut to STATUS_MAX characters at a word, so it ends cleanly: no half word, no dangling comma or "and". */
export function fitStatus(text: string) {
  const msg = text.replace(/\s+/g, ' ').trim()
  if (msg.length <= STATUS_MAX) return msg
  let cut = msg.slice(0, STATUS_MAX + 1).replace(/\s+\S*$/, '')
  if (cut.length > STATUS_MAX) return msg.slice(0, STATUS_MAX) // one word longer than the line
  for (let was = ''; was !== cut; ) {
    was = cut
    cut = cut.replace(/[\s,;:.(&+\u2013\u2014-]+$/, '').replace(/\s+(and|or|but|then|to|the|a|an|of|for|with|in|on|at|from|by|into)$/i, '')
  }
  return cut
}

/** a question mark that ends a sentence, not one in code (a?.b) or a path */
const ASKS = /\?(?=[\s"'”’)\]*_]|$)/

/**
 * The question an agent's last words ask you, as a status line: the last sentence that asks in its last paragraph
 * (links and code aside), cut to fit. Nothing when they ask nothing.
 */
export function askOf(text = ''): string | undefined {
  const last =
    text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\S+:\/\/\S+/g, '')
      .trim()
      .split(/\n\s*\n/)
      .at(-1) ?? ''
  const q = last.split(/\n+|(?<=[.!?])\s+(?=\S)/).findLast((s) => ASKS.test(s.replace(/`[^`]*`/g, '')))
  return q ? fitStatus(q.replace(/^\s*(?:[-*+>]|\d+[.)])\s+/, '').replace(/[*_`]+/g, '')) || undefined : undefined
}
