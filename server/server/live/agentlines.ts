// What an agent's reply may carry besides words: a <reply …/> line naming the message it answers, or <no-reply>.

import { tagOf } from './chatlines.ts'

/** the [square bracket] reply lines from before tags */
const OLD = {
  agentReply: /^\[reply to "(.*)"\]$/u,
  agentReplyFile: /^\[reply to ([^":]+?): (.+)\]$/u,
}

/** a reply that is only <no-reply>why</no-reply> says nothing (any case, in backticks too): the agent took in news that
 *  needs no words, and the terminal still says why. The older markers ([[noted]], any [[...]], a lone [noted]) still say nothing. */
const NO_REPLY = /^(`?)(<no-reply>(?:(?!<\/no-reply>)[\s\S])*<\/no-reply>|<no-reply\s*\/>)\1$/i
const OLD_MARKER = /^(\[\[[^[\]\n]+\]\]|\[noted\])$/

/** a reply that is or may become a hidden line as it streams in: one in brackets, or a tag an agent's reply may start
 *  with (none of them for the chat as words) or the start of one */
export const markerSoFar = (words: string) => {
  const w = words.replace(/^`/, '').toLowerCase()
  return w.startsWith('[') || ['<no-reply', '<reply'].some((t) => w.startsWith(t) || t.startsWith(w))
}

/** an agent's <reply …/> line; its tag may also open its words (<reply to="…">words</reply>) */
const AGENT_REPLY = /^<reply((?:\s+[\w-]+="[^\n]*?")+)\s*(\/?)>(.*)$/u

type Quote = { to: string; path?: string }

/** the reply the agent wrote as a line of its reply; returns the reply without it (and none for <no-reply>…</no-reply> or an older [[...]] marker) */
export function agentLines(text: string): { text: string; reply?: Quote } {
  let reply: Quote | undefined
  let opened = false
  let kept = text
    .split('\n')
    .flatMap((l) => {
      const s = l.trim()
      let m: RegExpMatchArray | null
      if ((m = s.match(AGENT_REPLY))) {
        const a = tagOf(`<reply${m[1]}/>`)!.a
        if ((a.to ?? a.file) === undefined || reply) return [l]
        reply = a.path ? { to: a.file ?? a.to ?? '', path: a.path } : { to: a.to ?? a.file ?? '' }
        opened = !m[2] && !m[3].endsWith('</reply>')
        const words = m[3].replace(/<\/reply>$/, '').trim()
        return words ? [words] : []
      }
      if ((m = s.match(OLD.agentReply))) reply ??= { to: m[1] }
      else if ((m = s.match(OLD.agentReplyFile))) reply ??= { to: m[1], path: m[2] }
      return m ? [] : [l]
    })
    .join('\n')
    .trim()
  // the end of a reply its tag opened
  if (opened) kept = kept.replace(/\s*<\/reply>$/, '')
  return { text: NO_REPLY.test(kept) || OLD_MARKER.test(kept) ? '' : kept, ...(reply ? { reply } : {}) }
}
