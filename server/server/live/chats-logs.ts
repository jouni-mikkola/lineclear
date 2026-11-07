import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatControls, Question } from '../../shared/types.ts'
import { HOME, readJson, writeJson } from '../store.ts'
import { stripHidden, type Agents, type OutItem } from './agents.ts'
import { agentLines } from './chatlines.ts'
import { herdr } from './herdr.ts'
import { LogTail, readerFor } from './readers/index.ts'
import type { LogEvent } from './readers/types.ts'
import { yours, turnOf, replying, type Posted, type ChatLog, safe, type ScreenMenu, parseMenu, PIECE } from './chats-helpers.ts'

export class ChatsLogs {
  constructor(
    protected agents: Agents,
    protected nameOf: (key: string) => string,
    protected user: () => string,
  ) {}

  protected tails = new Map<string, LogTail>()
  protected events = new Map<string, LogEvent[]>()
  /** where each reply and usage is in its chat's events, by kind and id: a reply read in two pieces replaces the first */
  protected where = new Map<string, Map<string, number>>()
  /** chats whose logs are still being read in the background */
  protected reading = new Set<string>()
  /** a chat's logs were read in the background to their end: what it shows changed */
  onRead?: (key: string) => void
  protected logs = new Map<string, ChatLog>()
  protected menus = new Map<string, ScreenMenu>()
  protected menuAt = new Map<string, number>()

  /* ---------- Lineclear's own log per chat ---------- */

  log(key: string): ChatLog {
    let l = this.logs.get(key)
    if (!l) {
      l = readJson<ChatLog>(`chatlog/${safe(key)}.json`, { posted: [], answers: {} })
      this.logs.set(key, l)
    }
    return l
  }

  saveLog(key: string) {
    writeJson(`chatlog/${safe(key)}.json`, this.log(key))
  }

  /** a deleted task's chat: its log goes, and all that was read of it */
  forget(key: string) {
    for (const m of [this.tails, this.events, this.where, this.reading, this.logs, this.menus, this.menuAt]) m.delete(key)
    rmSync(join(HOME, 'chatlog', `${safe(key)}.json`), { force: true })
  }

  /** told of each new post: the chat has something new (unread.ts) */
  onPost?: (key: string) => void

  post(key: string, p: Omit<Posted, 'at'> & { at?: number }) {
    const l = this.log(key)
    const i = l.posted.findIndex((x) => x.id === p.id)
    const item = { at: Date.now(), ...p }
    if (i >= 0) l.posted[i] = { ...l.posted[i], ...item, at: l.posted[i].at }
    else l.posted.push(item)
    this.saveLog(key)
    if (i < 0 && !p.who) this.onPost?.(key)
  }

  /** other: the words typed on the card in place of a pick; space: answered on its copy in that space's chat */
  answer(key: string, qid: string, choice: number, other?: string, space?: string) {
    const l = this.log(key)
    l.answers[qid] = choice
    if (other || space) (l.said ??= {})[qid] = { text: other, space }
    this.saveLog(key)
  }

  /** a reply to the agent's plain question went from its copy in a space's chat: the reply says so */
  repliedFrom(key: string, reply: string, space: string) {
    ;(this.log(key).said ??= {})[`reply:${reply}`] = { space }
    this.saveLog(key)
  }

  /** where a question answered on its copy in a space's chat says it was answered, with a link there */
  answeredIn = (space: string): Question['elsewhere'] => ({ label: 'Answered in', chat: space, name: `${this.nameOf(space)} chat` })

  /** a message you send answers the choice cards still open in that chat: they close as answered in words (-1), and
   *  keep those words to quote */
  closeAsks(key: string, text?: string) {
    const l = this.log(key)
    const open = l.posted.filter((p) => p.question?.id.startsWith('ask:') && p.question.sent === undefined && l.answers[p.question.id] === undefined)
    if (!open.length) return false
    for (const p of open) {
      l.answers[p.question!.id] = -1
      ;(l.said ??= {})[p.question!.id] = { text: text?.trim() || undefined, chat: true }
    }
    this.saveLog(key)
    return true
  }

  /* ---------- reading the CLI's logs ---------- */

  /** read new lines of this chat's log files, up to PIECE in all (the rest follows in the background); true when
   *  anything new came */
  pull(key: string): boolean {
    const { changed, behind } = this.read(key)
    if (behind) this.readOn(key)
    return changed
  }

  protected read(key: string): { changed: boolean; behind: boolean } {
    const r = this.agents.record(key)
    if (!r) return { changed: false, behind: false }
    let changed = false
    let behind = false
    let left = PIECE
    const all = this.events.get(key) ?? []
    const where = this.where.get(key) ?? new Map<string, number>()
    for (const f of r.logs) {
      if (!existsSync(f)) continue
      let t = this.tails.get(f)
      if (!t) {
        const reader = readerFor(r.kind)
        if (!reader) continue
        t = new LogTail(f, reader)
        this.tails.set(f, t)
      }
      const was = t.done
      const ev = t.read(left)
      left -= Math.max(0, t.done - was)
      for (const e of ev) {
        // a reply read in two pieces comes again with the same id and the full text: it replaces the first
        const id = e.kind === 'agent' || e.kind === 'usage' ? `${e.kind}:${e.id}` : undefined
        const i = id === undefined ? undefined : where.get(id)
        if (i !== undefined) all[i] = e
        else {
          if (id !== undefined) where.set(id, all.length)
          all.push(e)
        }
        changed = true
      }
      // the next log once this one is read to its end: the chat keeps its order
      if ((behind = t.behind || left <= 0)) break
    }
    if (changed) this.events.set(key, all), this.where.set(key, where)
    return { changed, behind }
  }

  /** reads the rest of a chat's logs a piece at a time, letting the server answer between pieces; told once at the end */
  protected readOn(key: string) {
    if (this.reading.has(key)) return
    this.reading.add(key)
    const step = () => {
      if (!this.reading.has(key)) return
      if (this.read(key).behind) return void setTimeout(step, 0)
      this.reading.delete(key)
      this.onRead?.(key)
    }
    setTimeout(step, 0)
  }

  /** tokens this chat's agent has used, across all its sessions */
  tokens(key: string): number {
    this.pull(key)
    return (this.events.get(key) ?? []).reduce((n, e) => n + (e.kind === 'usage' ? e.tokens : 0), 0)
  }

  /** what the agent last said, plain */
  lastReply(key: string): string | undefined {
    this.pull(key)
    const ev = this.events.get(key) ?? []
    for (let i = ev.length - 1; i >= 0; i--) {
      const e = ev[i]
      if (e.kind === 'agent') return agentLines(stripHidden(e.text)).text
    }
    return undefined
  }

  /** the newest thing in the chat from its agent (a reply you will see, its question) or Lineclear (a card):
   *  when it came, its words, and whether it is a card about a task (whose own alert tells of it) */
  newest(key: string): { at: number; text?: string; card?: boolean } | undefined {
    this.pull(key)
    const ev = this.events.get(key) ?? []
    const e = ev.findLast((x) => (x.kind === 'agent' && agentLines(stripHidden(x.text)).text) || x.kind === 'question')
    const p = this.log(key).posted.findLast((x) => !x.who)
    const reply = e && { at: e.at, text: e.kind === 'agent' ? agentLines(stripHidden(e.text)).text : undefined }
    const posted = p && { at: p.at, text: p.card?.text ?? p.text ?? p.question?.title, card: !!p.card }
    return !reply || (posted && posted.at > reply.at) ? posted : reply
  }

  /** a blocked agent's terminal menu, read from its screen (refreshed at most every 2s) */
  async readMenu(key: string, force = false): Promise<boolean> {
    const st = this.agents.status(key)
    if (!force && (st === 'working' || st === 'gone')) {
      const had = this.menus.delete(key)
      return had
    }
    const last = this.menuAt.get(key) ?? 0
    if (!force && Date.now() - last < 2000) return false
    this.menuAt.set(key, Date.now())
    const info = this.agents.info(key)
    if (!info) return false
    const text = await herdr.visible(info.pane_id)
    // Some herdr versions call startup checkbox menus idle. Require a live menu footer before parsing those.
    const waiting = /(?:enter.*(?:confirm|select|continue)|space to select.*esc to reject|\[y\/n\]|\(y\/n\))/i.test(
      text.trimEnd().split('\n').slice(-3).join('\n'),
    )
    const parsed = st === 'blocked' || waiting ? parseMenu(text) : null
    const m = parsed
      ? { ...parsed, screen: parsed.screen ?? text.trim() }
      : st === 'blocked' && text.trim()
        ? { title: 'The terminal is waiting for you', choices: [], cursor: 0, screen: text.trim() }
        : null
    const before = JSON.stringify(this.menus.get(key) ?? null)
    if (m) this.menus.set(key, m)
    else this.menus.delete(key)
    return before !== JSON.stringify(m)
  }

  menu(key: string) {
    return this.menus.get(key)
  }

  /** the question the CLI asks with its own tool, still open */
  openQuestion(key: string): { id: string; items: { question: string; options: { label: string }[]; multiSelect: boolean }[] } | undefined {
    const ev = this.events.get(key) ?? []
    const answered = new Set(ev.filter((e) => e.kind === 'answered').map((e) => e.id))
    for (let i = ev.length - 1; i >= 0; i--) {
      const e = ev[i]
      if (e.kind === 'question' && !answered.has(e.id)) return { id: e.id, items: e.items }
    }
    return undefined
  }

  /** a plan or choice card the agent posted since you last wrote to it, still unanswered */
  openCard(key: string): 'plan' | 'ask' | undefined {
    const id = this.openPosted(key)?.id
    return id?.startsWith('plan:') ? 'plan' : id?.startsWith('ask:') ? 'ask' : undefined
  }

  /** that card's question, as the agent wrote it */
  openCardTitle(key: string): string | undefined {
    return this.openPosted(key)?.title
  }

  protected openPosted(key: string): Question | undefined {
    this.pull(key)
    const l = this.log(key)
    const since = Math.max(
      0,
      ...(this.events.get(key) ?? []).filter((e) => e.kind === 'user').map((e) => e.at),
      ...l.posted.filter((p) => p.who === 'you').map((p) => p.at),
    )
    for (let i = l.posted.length - 1; i >= 0; i--) {
      const q = l.posted[i].question
      if (l.posted[i].at <= since) continue
      if (!q || q.sent !== undefined || l.answers[q.id] !== undefined) continue
      if (q.id.startsWith('plan:') || q.id.startsWith('ask:')) return q
    }
    return undefined
  }

  /** its log shows a turn that ended after this time: one cut short (Esc, a prompt turned down) */
  endedSince(key: string, at: number): boolean {
    this.pull(key)
    return (this.events.get(key) ?? []).some((e) => e.kind === 'turn-end' && e.at > at)
  }

  /**
   * What you or a coordinator wrote to this agent that it hasn't read yet: still waiting to go in, or typed in since its
   * turn began and not in its log since (Claude Code takes text typed mid-turn at its next step). Reactions and
   * Lineclear's own hidden lines aside.
   */
  unseen(key: string): OutItem[] {
    this.pull(key)
    const ev = this.events.get(key) ?? []
    const start = ev.findLast((e) => e.kind === 'turn-start')?.at ?? 0
    // the same words (a long paste may be kept as "[Pasted text #1]"), in its log since about when they went in
    const flat = (t: string) => stripHidden(t).replace(/\s+/g, ' ').trim()
    const same = (a: string, b: string) => a.startsWith(b.slice(0, 40)) || b.startsWith(a.slice(0, 40)) || /\[Pasted text #\d/.test(a)
    const read = (o: OutItem) => ev.some((e) => e.kind === 'user' && e.at >= o.at - 5000 && same(flat(e.text), flat(o.text)))
    const mine = (o: OutItem) => !o.reaction && yours(o.text)
    return [...this.agents.waiting(key).filter(mine), ...this.agents.typedSince(key, start).filter((o) => mine(o) && !read(o))]
  }

  protected replying(key: string, ev: LogEvent[]) {
    const turn = turnOf(ev, this.agents.sentLately(key))
    return replying(turn, ev)
  }

  /** pi changes model and effort only through its own picker: its menu only adds files */
  protected controls(): ChatControls {
    return { models: [], model: 0, efforts: [], effort: 0 }
  }
}
