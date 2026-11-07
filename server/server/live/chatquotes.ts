// Quotes: a reply names the message it answers by that message's start. This reads a reply back from the log and finds
// the message a quote names.

import { excerpt, OLD, parseUserLine, tagOf } from './chatlines.ts'

/** the words of a message and the attachments after them, on lines of their own */
function withFiles(text: string) {
  const lines = text.split('\n')
  let end = lines.length
  while (end > 0 && parseUserLine(lines[end - 1])?.kind === 'attach') end--
  return { head: lines.slice(0, end).join('\n').trim(), rest: lines.slice(end) }
}

/** your reply to a message, read back from the log: the reply line, then any files that came with it */
export function parseReply(text: string): { to: string; text: string; rest: string[]; line: string } | null {
  // files go on lines of their own after the words
  const { head: line, rest } = withFiles(text)
  const t = line.startsWith('<') ? tagOf(line) : null
  if (t) return t.name === 'reply' && t.a.from !== undefined ? { to: t.a.to ?? t.a.file ?? '', text: (t.body ?? '').trim(), rest, line } : null
  const m = line.match(OLD.reply)
  return m ? { to: m[2], text: m[3].trim(), rest, line } : null
}

/** the same words however they were quoted: curly quotes, case, markdown and spacing aside */
const plain = (s: string) =>
  s
    .replace(/[”“„]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/(…|\.\.\.)$/, '')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** the words of a quote, without the reply line around them when a whole line of ours was quoted */
const quotedWords = (quoted: string) =>
  plain(
    quoted
      .replace(/^\[?[^"\]]*? replied to "[^"]*"?:?\s*/, '')
      .replace(/\]$/, '')
      .replace(/^<reply\b[^>]*>/, '')
      .replace(/<\/reply>$/, ''),
  )

/** does this message start with the quoted excerpt (loose: a quote copied by hand may differ a little) */
export function matches(text: string, quoted: string, loose = false) {
  const a = plain(excerpt(text, 400))
  const b = quotedWords(quoted)
  if (!b) return false
  if (a.startsWith(b)) return true
  // loose: the quote is somewhere in it, or its start is (an agent may shorten or trim it)
  return loose && b.length >= 8 && (a.includes(b) || (b.length >= 24 && a.startsWith(b.slice(0, 24))))
}

/** the latest message a quote names: an exact start first, then a looser match */
export function findQuoted<M extends { text?: string; file?: { name: string; path: string } }>(msgs: M[], to: string, path?: string): M | undefined {
  const rev = [...msgs].reverse()
  if (path) return rev.find((m) => m.file?.path === path)
  const name = to.trim()
  return (
    rev.find((m) => (m.text ? matches(m.text, to) : m.file?.name === name)) ??
    rev.find((m) => !!m.text && matches(m.text, to, true)) ??
    rev.find((m) => !m.text && !!m.file && plain(m.file.name) === plain(name))
  )
}
