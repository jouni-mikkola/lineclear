// Chat lines: everything the screen draws beyond text travels as plain lines both ways, taught by one skill every
// agent gets. Each is an XML-style tag on a line of its own: its facts as attributes (double quotes in them made
// curly, so the tag stays whole), any words between its tags.
//
//   <attachment from="Elias" name="screenshot.png" path="~/inbox/screenshot.png"/>
//   <answer from="Elias" question="Rerun CI on main?">Rerun it</answer>
//   <reply from="Elias" to="Tests pass on the branch">Merge it then</reply>     (the start of the message it answers)
// An agent's own lines are in agentlines.ts. Lineclear's lines to agents are <lineclear type="news">…</lineclear> and
// the like (agents.ts hidden). The older [square bracket] lines still read back, from old chat logs.

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
  attach: (user: string, name: string, path: string) => tag('attachment', { from: user, name, path }),
  answer: (user: string, title: string, answer: string) => tag('answer', { from: user, question: title }, answer),
  /** never its value */
  secret: (user: string, name: string, where: string) => tag('secret', { from: user, name, for: where }),
  reply: (user: string, quoted: string, text: string) => tag('reply', { from: user, to: excerpt(quoted) }, text),
}

export type Parsed =
  | { kind: 'attach'; name: string; path: string }
  | { kind: 'answer'; title: string; answer: string }
  | { kind: 'secret'; name: string; where: string }

/** a whole tag on its own: <name a="…"/> or <name a="…">words</name>; a value may hold a stray " (one an agent quoted
 *  by hand) */
export function tagOf(s: string): { name: string; a: Record<string, string>; body?: string } | null {
  const m = s.match(/^<([a-z][\w-]*)((?:\s+[\w-]+="[^\n]*?")*)\s*(?:\/>|>([\s\S]*)<\/\1>)$/u)
  if (!m) return null
  const a: Record<string, string> = {}
  for (const x of m[2].matchAll(/([\w-]+)="([^\n]*?)"(?=\s+[\w-]+="|\s*$)/gu)) a[x[1]] = x[2]
  return { name: m[1], a, body: m[3] }
}

export const OLD = {
  attach: /^\[(.+?) attached (.+?): (.+)\]$/u,
  answer: /^\[(.+?) answered "(.*?)": ([\s\S]*)\]$/u,
  reply: /^\[(.+?) replied to "(.*?)": ([\s\S]*)\]$/u,
}

/** a line you sent, read back from the log */
export function parseUserLine(l: string): Parsed | null {
  const s = l.trim()
  const t = s.startsWith('<') ? tagOf(s) : null
  if (t) {
    const { a, body = '' } = t
    if (t.name === 'attachment' && a.path) return { kind: 'attach', name: a.name ?? a.path.split('/').pop()!, path: a.path }
    if (t.name === 'answer') return { kind: 'answer', title: a.question ?? '', answer: body }
    if (t.name === 'secret' && a.name) return { kind: 'secret', name: a.name, where: a.for ?? '' }
    return null
  }
  const [answer, attach] = [s.match(OLD.answer), s.match(OLD.attach)]
  if (answer) return { kind: 'answer', title: answer[2], answer: answer[3] }
  return attach ? { kind: 'attach', name: attach[2], path: attach[3] } : null
}

/** what you sent, line by line, an answer or reply whose words run over several lines kept whole (its last closing tag:
 *  the words may hold one of their own) */
export function userLines(text: string): string[] {
  const lines = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].trim().match(/^<(answer|reply)[\s>]/)
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
