import { createHash } from 'node:crypto'
import type { Message, Question, SecretAsk, UpdateCard } from '../../shared/types.ts'
import { stripHidden } from './agents.ts'
import { agentLines, markerSoFar, parseUserLine, type Parsed } from './chatlines.ts'
import type { LogEvent } from './readers/types.ts'

/** a chat line of yours that shows as words: an answer, a secret you gave */
export function shownAs(p: Parsed): { title?: string; text: string } | undefined {
  if (p.kind === 'answer') return { title: `Answered “${p.title}”`, text: p.answer }
  if (p.kind === 'secret') return { title: 'Gave a secret', text: `${p.name}${p.where ? `, for ${p.where}` : ''}` }
  return undefined
}

/** a line of yours the agent will answer: words of yours, not Lineclear's hidden news and not only reactions */
export const yours = (text: string) =>
  stripHidden(text)
    .split('\n')
    .some((ln) => ln.trim() && !['react', 'unreact'].includes(parseUserLine(ln.trim())?.kind ?? ''))

/** The turn the agent is in, by its log: one your message started ('yours'), one it started itself on Lineclear's news,
 *  its background work waking it ('own', with that turn's id), or none ('over': its reply ended the
 *  last one, and what herdr still sees working is background work: a subagent, a shell). No turn marks: 'unknown'. */
export function turnOf(ev: LogEvent[], sent: { at: number }[]): { kind: 'yours' | 'own' | 'over' | 'unknown'; id?: string } {
  if (!ev.some((e) => e.kind === 'turn-start' || e.kind === 'turn-end')) return { kind: 'unknown' }
  const end = ev.findLastIndex((e) => e.kind === 'turn-end')
  // what you sent from a screen since the last turn ended went in before the CLI wrote it down: its turn is on its way
  if (sent.some((o) => o.at > (end < 0 ? -Infinity : ev[end].at))) return { kind: 'yours' }
  const now = ev.slice(end + 1)
  const start = now.find((e) => e.kind === 'turn-start')
  if (!start) return { kind: 'over' }
  // yours once a message of yours is in it, even one taken in mid-turn
  return now.some((e) => e.kind === 'user' && yours(e.text)) ? { kind: 'yours' } : { kind: 'own', id: start.id }
}

/** a reply you will see that already landed in the agent's own turn (a hidden <no-reply> is none) */
const landed = (ev: LogEvent[]) => {
  const start = ev.findLastIndex((e) => e.kind === 'turn-start')
  return start >= 0 && ev.slice(start).some((e) => e.kind === 'agent' && agentLines(stripHidden(e.text)).text)
}

/** Do the typing dots show: is a message you will see on its way? In a turn you started, at once (an agent never
 *  answers you with a hidden <no-reply>). In one it started itself, only once its reply shows: on its screen as it
 *  streams (`shown`) or landed in its log; until then it may be thinking, running tools, or about to say <no-reply>. */
export function replying(turn: ReturnType<typeof turnOf>, shown: boolean, ev: LogEvent[]): boolean {
  if (turn.kind === 'yours' || turn.kind === 'unknown') return true
  return turn.kind === 'own' && (shown || landed(ev))
}

/** what the screen showed of the reply in a turn the agent started itself */
export interface Shown {
  turn: string
  /** the reply's text at the last read; it must grow once before it counts, so a still line (a job's "completed") never does */
  last?: string
  on: boolean
  at: number
}

/** something Lineclear posted into a chat */
export interface Posted {
  id: string
  at: number
  card?: UpdateCard
  question?: Question
  /** a secret the agent asked for: its masked box */
  secret?: SecretAsk
  /** text shown with it, when it stands alone */
  text?: string
  /** a line of yours Lineclear shows for you (an answer typed as keys, or a command, which the log doesn't keep) */
  who?: 'you'
  answered?: string
  /** answered on the question's copy in a space's chat: a link there */
  elsewhere?: Question['elsewhere']
  /** the screen's own id for it: the log's line, when it has one after all, shows instead */
  cid?: string
}

export interface ChatLog {
  posted: Posted[]
  /** the choice you sent for each question, by question id */
  answers: Record<string, number>
  /** the words a question was answered with instead of a pick, by question id; chat: a message in the chat; space: on
   *  its copy in that space's chat */
  said?: Record<string, { text?: string; chat?: true; space?: string }>
}

/** a card Lineclear posted, with its answer: a choice card answered without a pick and no words typed on it was
 *  answered by a message in the chat (closeAsks; older logs kept no words) */
export function withAnswer(q: Question, l: ChatLog, place: (key: string) => Question['elsewhere']): Question {
  const sent = q.sent ?? l.answers[q.id]
  const s = l.said?.[q.id]
  const elsewhere = s?.space ? place(s.space) : undefined
  if (sent !== -1) return { ...q, sent, elsewhere }
  return { ...q, sent, said: s?.text, via: s?.chat || (!s && q.id.startsWith('ask:')) ? 'chat' : undefined, elsewhere }
}

export const safe = (key: string) => key.replace(/[^a-zA-Z0-9_.-]+/g, '_')

/** a menu the CLI shows in its terminal (permission prompts and the like), read from the screen */
export interface ScreenMenu {
  title: string
  choices: string[]
  /** what the CLI shows under each choice, in grey (Claude Code's own questions): none, or one per choice */
  descriptions?: (string | undefined)[]
  /** the choice the CLI's cursor is on */
  cursor: number
  /** Direct keys for y/n prompts; otherwise move the menu cursor and confirm. */
  keys?: string[][]
  multi?: boolean
  selected?: number[]
  reject?: string
  /** The visible prompt, including security context that must not be lost. */
  screen?: string
}

/** A card's identity excludes the cursor, but includes the full permission being granted. */
export function menuId(key: string, m: ScreenMenu) {
  const screen = m.multi
    ? m.screen
        ?.split('\n')
        .map((l) =>
          l
            .trim()
            .replace(/^[❯›>▶]\s*/, '')
            .replace(/^\[[✔✓x ]\]/, '[ ]'),
        )
        .join('\n')
    : m.screen?.replace(/^(\s*)[❯›>▶](?=\s)/gm, '$1 ')
  return `menu:${key}:${createHash('sha256')
    .update(JSON.stringify([m.title, m.choices, screen]))
    .digest('hex')
    .slice(0, 16)}`
}

export function menuKeys(m: ScreenMenu, choice: number, choices?: number[]): string[] | undefined {
  if (m.multi) {
    if (!choices) return
    if (!choices.length && choice === -1) return ['escape']
    if (choices.some((i) => !Number.isInteger(i) || i < 0 || i >= m.choices.length)) return
    const keys: string[] = []
    let cursor = m.cursor
    const move = (to: number) => {
      const d = to - cursor
      keys.push(...Array(Math.abs(d)).fill(d > 0 ? 'down' : 'up'))
      cursor = to
    }
    for (let i = 0; i < m.choices.length; i++)
      if (choices.includes(i) !== !!m.selected?.includes(i)) {
        move(i)
        keys.push('space')
      }
    move(m.choices.length)
    keys.push('enter')
    return keys
  }
  if (!Number.isInteger(choice) || choice < 0 || choice >= m.choices.length) return
  const d = choice - m.cursor
  return m.keys?.[choice] ?? [...Array(Math.abs(d)).fill(d > 0 ? 'down' : 'up'), 'enter']
}

/** Drop shell startup and old output above the prompt's separator. Keep all of the consent text. */
function promptScreen(lines: string[], first: number) {
  for (let i = first - 1; i >= 0; i--)
    if (/^\s*[╭┌│|]?[─━─]{5,}/.test(lines[i]))
      return lines
        .slice(i + 1)
        .join('\n')
        .trim()
  return lines.join('\n').trim()
}

/** Unnumbered arrow menus and single-line confirmations, as used at startup. */
function startupMenu(lines: string[]): ScreenMenu | null {
  const screen = lines.join('\n').trim()
  const clean = (s: string) => s.replace(/^[\s─╭╰]+|[\s─╮╯]+$/g, '').trim()
  // Claude's multi-server MCP consent is a checkbox list followed by a submit row.
  if (/new MCP servers found in this project/i.test(screen) && /Space to select.*Esc to reject all/i.test(screen)) {
    const first = lines.findIndex((l) => /^\s*[❯›>▶]?\s*\[[✔✓x ]\]\s+/.test(l))
    const rows = lines.slice(first).filter((l) => /^\s*[❯›>▶]?\s*\[[✔✓x ]\]\s+/.test(l))
    if (first >= 0 && rows.length) {
      const cursor = rows.findIndex((l) => /[❯›>▶]/.test(l))
      return {
        title: lines.find((l) => /new MCP servers found in this project/i.test(l))!.trim(),
        choices: rows.map((l) => l.replace(/^\s*[❯›>▶]?\s*\[[✔✓x ]\]\s+/, '').trim()),
        cursor: cursor < 0 ? rows.length : cursor,
        multi: true,
        selected: rows.flatMap((l, i) => (/\[[✔✓x]\]/.test(l) ? [i] : [])),
        reject: 'Reject all',
        screen: promptScreen(lines, first),
      }
    }
  }
  const cursor = lines.findLastIndex((l) => /^\s*[❯›>▶]\s+\S/.test(l))
  if (cursor >= 0 && /enter.*(?:confirm|select|continue)|[↑↓]|arrow keys/i.test(screen)) {
    const col = lines[cursor].search(/[❯›>▶]/) + 2
    const isOption = (i: number) =>
      i === cursor ||
      (!!lines[i]?.trim() &&
        lines[i].search(/\S/) === col &&
        !/^(?:enter|esc|press |[↑↓]|arrow keys).*?(?:confirm|select|continue|cancel|navigate|back)/i.test(lines[i].trim()))
    let first = cursor,
      last = cursor
    while (first > 0 && isOption(first - 1)) first--
    while (last + 1 < lines.length && isOption(last + 1)) last++
    if (last > first) {
      const choices = lines.slice(first, last + 1).map((l) => l.replace(/^\s*[❯›>▶]?\s*/, '').trim())
      const context = lines.slice(0, first).map(clean).filter(Boolean)
      const title = context.findLast((l) => /\?|MCP servers? found|trust|accessing workspace/i.test(l)) ?? context.at(-1) ?? 'Choose an option'
      return { title, choices, cursor: cursor - first, screen: promptScreen(lines, first) }
    }
  }
  const yn = screen.match(/([^\n]*?)(?:\[y\/n\]|\(y\/n\)|\[yes\/no\]|\(yes\/no\))\s*[:?]?\s*$/i)
  if (yn)
    return {
      title: yn[1].trim() || 'Continue?',
      choices: ['Yes', 'No'],
      cursor: 0,
      keys: [
        ['y', 'enter'],
        ['n', 'enter'],
      ],
      screen,
    }
  return null
}

export function parseMenu(screen: string): ScreenMenu | null {
  const lines = screen.split('\n').map((l) => l.replace(/\s+$/, '').replace(/^[\s│|]+|[│|]+$/g, (m) => m.replace(/[│|]/g, ' ')))
  const OPT = /^(\s*)([❯›>▶*]\s*)?(\d{1,2})[.)]\s+(.+)$/
  // the last numbered list on screen that starts at 1
  let first = -1
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 40); i--) {
    const m = lines[i].match(OPT)
    if (m && m[3] === '1') {
      first = i
      break
    }
  }
  if (first < 0) return startupMenu(lines)
  const opts: { label: string; description?: string; on: boolean }[] = []
  let indent = 0
  // the terminal's width, by its longest line: a line wraps only once the next word would pass it
  const width = Math.max(...lines.map((l) => l.trimEnd().length))
  for (let i = first; i < lines.length; i++) {
    const l = lines[i]
    const m = l.match(OPT)
    if (m && Number(m[3]) === opts.length + 1) {
      opts.push({ label: m[4].trim(), on: !!m[2] })
      indent = m[1].length + (m[2]?.length ?? 0)
      continue
    }
    // an indented line under a choice: the choice wrapping on, or (under a line that had room for more) its description
    if (opts.length && l.trim() && l.search(/\S/) > indent) {
      const o = opts[opts.length - 1]
      const wraps = lines[i - 1].trimEnd().length + 1 + l.trim().split(' ')[0].length > width
      if (o.description !== undefined || !wraps) o.description = o.description === undefined ? l.trim() : `${o.description} ${l.trim()}`
      else o.label += ` ${l.trim()}`
      continue
    }
    if (!l.trim() && opts.length) continue
    break
  }
  if (opts.length < 2) return null
  for (const o of opts) o.label = o.label.replace(/\s*\((esc|enter|tab|[a-z])\)$/i, '').trim()
  // the question: the nearest line above the list with a "?"
  const clean = (x: string) => x.replace(/^[\s╭╰─]+|[\s╮╯─]+$/g, '').trim()
  const asks = /would you like|do you want|allow|proceed|run the following|run this/i
  const marked = [...Array(Math.min(14, first)).keys()].map((k) => first - 1 - k).filter((i) => lines[i].includes('?'))
  const qi = marked.find((i) => asks.test(lines[i])) ?? marked[0] ?? -1
  if (qi < 0) return null
  // a question that wraps: its lines above, while each goes on from the one before (starts in lower case)
  let top = qi
  while (top > 0 && /^[a-z]/.test(clean(lines[top])) && clean(lines[top - 1])) top--
  const qline = lines
    .slice(top, qi + 1)
    .map(clean)
    .join(' ')
  const qmark = qline.indexOf('?')
  const question = qline.slice(Math.max(qline.lastIndexOf('. ', qmark) + 1, 0), qmark + 1).trim()
  // the command being asked about, when the CLI shows one between the question and the list
  const shown = lines
    .slice(qi + 1, first)
    .map(clean)
    .filter(Boolean)
  const at = shown.findIndex((l) => l.startsWith('$ '))
  const cmd =
    (at >= 0
      ? shown
          .slice(at)
          .filter((l, k) => k === 0 || !/[?:]$/.test(l))
          .join(' ')
          .slice(2)
      : undefined) ??
    lines
      .slice(Math.max(0, qi - 4), qi)
      .map(clean)
      .filter((l) => l && !/[.:]$/.test(l) && !/^(Bash|Edit|Write|Read)( command)?$/i.test(l))
      .at(-1)
  const asksToRun = asks.test(question)
  const title = asksToRun && cmd ? `Allow: ${cmd.replace(/\?$/, '')}?` : question
  const descriptions = opts.some((o) => o.description) ? opts.map((o) => o.description) : undefined
  return {
    title,
    screen: promptScreen(lines, first),
    choices: opts.map((o) => o.label),
    ...(descriptions ? { descriptions } : {}),
    cursor: Math.max(
      0,
      opts.findIndex((o) => o.on),
    ),
  }
}

/** words as typed, whatever the spacing a CLI's log keeps */
export const words = (s: string) => s.replace(/\s+/g, ' ').trim()

/** the message each reply sent from a screen answers, by the words of its line: a quote alone may fit a newer message
    that starts the same way ("Done."). Kept until a restart; after one the quote finds it. */
export const replied = new Map<string, string>()

export function rememberReply(line: string, id: string) {
  replied.set(words(line), id)
  if (replied.size > 500) replied.delete(replied.keys().next().value!)
}

/** the agent's reply of the same turn, written at or after `at`, before you wrote again */
export function hostFor(msgs: Message[], at: number, p: { question?: unknown }): Message | undefined {
  for (const m of msgs) {
    if ((m.at ?? 0) < at - 1000) continue
    if (m.who === 'you') return undefined
    if (m.text && !m.card && !(p.question && m.question)) return m
  }
  return undefined
}

/** one more read of the screen: the reply counts once it grew since the last read and, past its reaction and reply
 *  lines, starts with two letters or more that aren't a hidden marker (<no-reply>, an older [[...]]), whole or still coming */
export function sawReply(s: Pick<Shown, 'last' | 'on'>, text: string | undefined): Pick<Shown, 'last' | 'on'> {
  const words = text === undefined ? '' : agentLines(text).text
  const ok = words.length >= 2 && !markerSoFar(words)
  return { on: s.on || (ok && s.last !== undefined && text !== s.last), last: ok ? text : undefined }
}

/** how much of a chat's logs one pull reads: the rest is read in the background a piece at a time, so a log of a
 *  hundred MB (a long-lived coordinator's) never holds up the server, at a restart or as it grows */
export const PIECE = 2 << 20
