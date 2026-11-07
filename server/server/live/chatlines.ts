// Chat lines: everything the screen draws beyond text travels as plain lines both ways, taught by one skill every
// agent gets (like an iPhone sending a reaction to an Android phone as text). Each is an XML-style tag on a line of its
// own: its facts as attributes (double quotes in them made curly, so the tag stays whole), any words between its tags.
//
//   <reaction from="Elias" emoji="👍" to="PR #52 is ready to merge"/>
//   <reaction-removed from="Elias" emoji="👍" to="PR #52 is ready to merge"/>
//   <reaction from="Elias" emoji="👍" file="screenshot.png" path="~/inbox/screenshot.png"/>   (a file: by its path)
//   <attachment from="Elias" name="screenshot.png" path="~/inbox/screenshot.png"/>
//   <answer from="Elias" question="Rerun CI on main?">Rerun it</answer>
//   <reply from="Elias" to="Tests pass on the branch">Merge it then</reply>     (the start of the message it answers)
//   agent → <react emoji="👀" to="What needs me today?"/>   or   <react emoji="👀" file="screenshot.png" path="~/inbox/screenshot.png"/>
//   agent → <reply to="What needs me today?"/>      a line of its own, then its reply
//   agent → <no-reply>SHE-72 merged, nothing to do</no-reply>   a reply that is only this shows nothing (news with nothing to say)
//
// Lineclear's own lines to agents are <lineclear type="news">…</lineclear> and the like (agents.ts hidden). The older
// [square bracket] lines still read back, from agents started before the change and from old chat logs.

import { excerpt } from '../../shared/excerpt.ts'

export { excerpt }

/** a value as an attribute: on one line, its double quotes made curly */
const attr = (s: string) =>
  s
    .replace(/\s*\n\s*/g, ' ')
    .replace(/"([^"]*)"/g, '“$1”')
    .replace(/"/g, '”')

/** a tag: <name a="…"/>, or <name a="…">words</name> when it has words (empty ones too) */
export function tag(name: string, attrs: Record<string, string | number | undefined>, body?: string) {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${attr(String(v))}"`)
    .join('')
  return body === undefined ? `<${name}${a}/>` : `<${name}${a}>${body}</${name}>`
}

export const line = {
  react: (user: string, emoji: string, text: string) => tag('reaction', { from: user, emoji, to: excerpt(text) }),
  unreact: (user: string, emoji: string, text: string) => tag('reaction-removed', { from: user, emoji, to: excerpt(text) }),
  /** a file by its path, which no other file has: two files may share a name */
  reactFile: (user: string, emoji: string, name: string, path: string) => tag('reaction', { from: user, emoji, file: name, path }),
  unreactFile: (user: string, emoji: string, name: string, path: string) => tag('reaction-removed', { from: user, emoji, file: name, path }),
  attach: (user: string, name: string, path: string) => tag('attachment', { from: user, name, path }),
  answer: (user: string, title: string, answer: string) => tag('answer', { from: user, question: title }, answer),
  /** a secret you gave, by its name and where it is kept: never its value */
  secret: (user: string, name: string, where: string) => tag('secret', { from: user, name, for: where }),
  /** your words in reply to a message (a file by its name): the words may run over several lines */
  reply: (user: string, quoted: string, text: string) => tag('reply', { from: user, to: excerpt(quoted) }, text),
}

export type Parsed =
  | { kind: 'react'; emoji: string; to: string; path?: string }
  | { kind: 'unreact'; emoji: string; to: string; path?: string }
  | { kind: 'attach'; name: string; path: string }
  | { kind: 'answer'; title: string; answer: string }
  | { kind: 'secret'; name: string; where: string }

/** a whole tag on its own: <name a="…"/> or <name a="…">words</name>; a value may hold a stray " (one an agent quoted
 *  by hand) */
function tagOf(s: string): { name: string; a: Record<string, string>; body?: string } | null {
  const m = s.match(/^<([a-z][\w-]*)((?:\s+[\w-]+="[^\n]*?")*)\s*(?:\/>|>([\s\S]*)<\/\1>)$/u)
  if (!m) return null
  const a: Record<string, string> = {}
  for (const x of m[2].matchAll(/([\w-]+)="([^\n]*?)"(?=\s+[\w-]+="|\s*$)/gu)) a[x[1]] = x[2]
  return { name: m[1], a, body: m[3] }
}

/** a reaction's quote: a message's start, or a file by its name and path */
const quoteOf = (a: Record<string, string>) => (a.path ? { to: a.file ?? a.to ?? '', path: a.path } : { to: a.to ?? a.file ?? '' })

/** the [square bracket] lines from before tags: still read back, from old chat logs and agents started before */
const OLD = {
  react: /^\[(.+?) reacted (\S+) to "(.*)"\]$/u,
  unreact: /^\[(.+?) removed (\S+) from "(.*)"\]$/u,
  reactFile: /^\[(.+?) reacted (\S+) to ([^":]+?): (.+)\]$/u,
  unreactFile: /^\[(.+?) removed (\S+) from ([^":]+?): (.+)\]$/u,
  attach: /^\[(.+?) attached (.+?): (.+)\]$/u,
  answer: /^\[(.+?) answered "(.*?)": ([\s\S]*)\]$/u,
  reply: /^\[(.+?) replied to "(.*?)": ([\s\S]*)\]$/u,
  agentReact: /^\[react (\S+) to "(.*)"\]$/u,
  agentReply: /^\[reply to "(.*)"\]$/u,
  agentReplyFile: /^\[reply to ([^":]+?): (.+)\]$/u,
  agentReactFile: /^\[react (\S+) to ([^":]+?): (.+)\]$/u,
}

/** a line you sent, read back from the log */
export function parseUserLine(l: string): Parsed | null {
  const s = l.trim()
  const t = s.startsWith('<') ? tagOf(s) : null
  if (t) {
    const { a, body = '' } = t
    if ((t.name === 'reaction' || t.name === 'reaction-removed') && a.emoji)
      return { kind: t.name === 'reaction' ? 'react' : 'unreact', emoji: a.emoji, ...quoteOf(a) }
    if (t.name === 'attachment' && a.path) return { kind: 'attach', name: a.name ?? a.path.split('/').pop()!, path: a.path }
    if (t.name === 'answer') return { kind: 'answer', title: a.question ?? '', answer: body }
    if (t.name === 'secret' && a.name) return { kind: 'secret', name: a.name, where: a.for ?? '' }
    return null
  }
  let m: RegExpMatchArray | null
  if ((m = s.match(OLD.react))) return { kind: 'react', emoji: m[2], to: m[3] }
  if ((m = s.match(OLD.unreact))) return { kind: 'unreact', emoji: m[2], to: m[3] }
  if ((m = s.match(OLD.reactFile))) return { kind: 'react', emoji: m[2], to: m[3], path: m[4] }
  if ((m = s.match(OLD.unreactFile))) return { kind: 'unreact', emoji: m[2], to: m[3], path: m[4] }
  if ((m = s.match(OLD.answer))) return { kind: 'answer', title: m[2], answer: m[3] }
  if ((m = s.match(OLD.attach))) return { kind: 'attach', name: m[2], path: m[3] }
  return null
}

/** the tags whose words may run over several lines */
const LONG = /^<(answer|reply)[\s>]/

/** what you sent, line by line, a tag whose words run over several lines kept whole */
export function userLines(text: string): string[] {
  const lines = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].trim().match(LONG)
    // its last closing tag: the words may hold one of their own
    const close = open && lines.findLastIndex((l, j) => j >= i && l.trimEnd().endsWith(`</${open[1]}>`))
    if (
      close &&
      close > i &&
      tagOf(
        lines
          .slice(i, close + 1)
          .join('\n')
          .trim(),
      )
    ) {
      out.push(lines.slice(i, close + 1).join('\n'))
      i = close
    } else out.push(lines[i])
  }
  return out
}

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

type Quote = { to: string; path?: string }

/** a reply that is only <no-reply>why</no-reply> says nothing (any case, in backticks too): the agent took in news that
 *  needs no words, and the terminal still says why. The older markers ([[noted]], any [[...]], a lone [noted]) still say nothing for agents
 *  started before the rename. */
const NO_REPLY = /^(`?)(<no-reply>(?:(?!<\/no-reply>)[\s\S])*<\/no-reply>|<no-reply\s*\/>)\1$/i
const OLD_MARKER = /^(\[\[[^[\]\n]+\]\]|\[noted\])$/

/** an agent's <react …/> or <reply …/> line; a reply's tag may also open its words (<reply to="…">words</reply>) */
const AGENT_TAG = /^<(react|reply)((?:\s+[\w-]+="[^\n]*?")+)\s*(\/?)>(.*)$/u

/** reactions and a reply the agent wrote as lines of its reply; returns the reply without them (and none for <no-reply>…</no-reply> or an older [[...]] marker) */
export function agentLines(text: string): { text: string; reactions: (Quote & { emoji: string })[]; reply?: Quote } {
  const reactions: (Quote & { emoji: string })[] = []
  let reply: Quote | undefined
  let opened = false
  let kept = text
    .split('\n')
    .flatMap((l) => {
      const s = l.trim()
      let m: RegExpMatchArray | null
      if ((m = s.match(AGENT_TAG))) {
        const t = tagOf(`<${m[1]}${m[2]}/>`)!
        const words = m[4].replace(/<\/reply>$/, '').trim()
        if (m[1] === 'react' && t.a.emoji && (t.a.to ?? t.a.file) !== undefined) {
          reactions.push({ emoji: t.a.emoji, ...quoteOf(t.a) })
          return words ? [words] : []
        }
        if (m[1] === 'reply' && (t.a.to ?? t.a.file) !== undefined && !reply) {
          reply = quoteOf(t.a)
          opened = !m[3] && !m[4].endsWith('</reply>')
          return words ? [words] : []
        }
        return [l]
      }
      if ((m = s.match(OLD.agentReact))) reactions.push({ emoji: m[1], to: m[2] })
      else if ((m = s.match(OLD.agentReactFile))) reactions.push({ emoji: m[1], to: m[2], path: m[3] })
      else if ((m = s.match(OLD.agentReply))) reply ??= { to: m[1] }
      else if ((m = s.match(OLD.agentReplyFile))) reply ??= { to: m[1], path: m[2] }
      return m ? [] : [l]
    })
    .join('\n')
    .trim()
  // the end of a reply its tag opened
  if (opened) kept = kept.replace(/\s*<\/reply>$/, '')
  return { text: NO_REPLY.test(kept) || OLD_MARKER.test(kept) ? '' : kept, reactions, ...(reply ? { reply } : {}) }
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
