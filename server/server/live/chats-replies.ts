import { cardMessage, type Chat, type Message } from '../../shared/types.ts'
import { stripHidden } from './agents.ts'
import { agentLines } from './agentlines.ts'
import { excerpt } from './chatlines.ts'
import { findQuoted } from './chatquotes.ts'
import { yourMessages, yourParts } from './chats-yours.ts'
import { findModel } from '../../../src/models.ts'
import { sessionRuntime } from './runtime.ts'
import { launchHarness } from './restart.ts'
import { CLI_NAME } from './settings.ts'
import { menuCard } from './chats-menu.ts'
import { withAnswer, questionMessages, words, replied, hostFor } from './chats-helpers.ts'
import { ChatsLogs } from './chats-logs.ts'

export class ChatsReplies extends ChatsLogs {
  /* ---------- the chat as the screen draws it ---------- */

  chat(key: string): Chat {
    this.pull(key)
    const r = this.agents.record(key)
    const kind = r?.kind ?? 'claude'
    const from = this.nameOf(key)
    const ev = this.events.get(key) ?? []
    const l = this.log(key)
    const msgs: Message[] = []
    const answered = new Set(ev.filter((e) => e.kind === 'answered').map((e) => e.id))
    /** a reply's quote of the message it answers: that message when it is still in the chat, else the quote alone */
    const replyTo = (quoted: string, path?: string, line?: string): Message['reply'] => {
      const id = line && replied.get(words(line))
      const m = (id && msgs.find((x) => x.id === id)) || findQuoted(msgs, quoted, path)
      if (!m) return { text: quoted.replace(/”/g, '"') }
      return { id: m.id, who: m.who, text: m.text ? excerpt(m.text, 160) : (m.file?.name ?? ''), ...(m.text ? {} : { file: true }) }
    }
    // what you sent from a screen gets the screen's id back, so the screen swaps the message it showed at once for it:
    // the same words, read from the log once they went in
    const lately = this.agents.sentLately(key).map((o) => ({ cid: o.cid!, at: o.at, words: words(stripHidden(o.text)) }))
    const cidFor = (text: string, at: number) => {
      const i = lately.findIndex((o) => at >= o.at - 3000 && o.words === words(text))
      return i < 0 ? undefined : lately.splice(i, 1)[0].cid
    }
    // Lineclear's update cards are messages too, among the rest by time, so a reply can quote one
    const cards = l.posted.filter((p) => p.card).map((p) => cardMessage(p.card!, p.at))
    let sessions = 0
    let newSession = false
    for (const e of ev) {
      while (cards.length && (cards[0].at ?? 0) <= e.at) msgs.push(cards.shift()!)
      if (e.kind === 'session') {
        if (sessions++) newSession = true
        continue
      }
      if (e.kind === 'user') {
        const text = stripHidden(e.text)
        if (!text) continue
        const parts = yourParts(text, replyTo)
        const cid = parts.answered ? undefined : cidFor(text, e.at)
        const mine = yourMessages(e.id, e.at, parts, { cid }, newSession)
        msgs.push(...mine)
        if (mine.length) newSession = false
        continue
      }
      if (e.kind === 'agent') {
        const { text, reply } = agentLines(stripHidden(e.text))
        if (!text) continue
        msgs.push({ id: e.id, who: 'agent', at: e.at, text, newSession: newSession || undefined, reply: reply ? replyTo(reply.to, reply.path) : undefined })
        newSession = false
        continue
      }
      if (e.kind === 'question') msgs.push(...questionMessages(e, l, from, answered.has(e.id), this.answeredIn))
    }
    msgs.push(...cards)
    msgs.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    // what else Lineclear posted: a question joins the agent's reply of that turn
    const echoed = new Set<Message>()
    for (const p of l.posted) {
      if (p.card) continue
      if (p.who === 'you') {
        // once the log has what you sent (by its id), the log's line shows, in your words
        const logged = p.cid ? msgs.find((m) => m.cid === p.cid) : undefined
        if (logged) {
          echoed.add(logged)
          // at when it went in: Claude Code logs a menu's command once the menu closes
          Object.assign(logged, { text: p.text, cid: p.cid, at: Math.min(logged.at ?? p.at, p.at) })
          continue
        }
        msgs.push({ id: p.id, who: 'you', at: p.at, text: p.text, answered: p.answered, elsewhere: p.elsewhere, cid: p.cid })
        continue
      }
      if (p.secret) {
        msgs.push({ id: p.id, who: 'agent', at: p.at, secret: p.secret })
        continue
      }
      const q = p.question ? withAnswer(p.question, l, this.answeredIn) : undefined
      const host = hostFor(msgs, p.at, p)
      if (host && !p.text) {
        if (q) host.question = q
      } else msgs.push({ id: p.id, who: 'agent', at: p.at, text: p.text, question: q })
    }
    msgs.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    // what waits to go in, and why: the first in line holds the rest
    const queue = this.agents.waiting(key)
    const waitsFor = queue.length ? this.agents.holdOf(key, queue[0]) : undefined
    for (const o of queue) {
      // what Lineclear itself sends (instructions, news) is stripped and never shows as yours
      msgs.push(...yourMessages(o.id, o.at, yourParts(o.text, replyTo), { waiting: true, waitsFor, cid: o.cid }))
    }
    // your reply to a plain question, sent from its copy in a space's chat: a link there
    for (const [id, s] of Object.entries(l.said ?? {}))
      if (id.startsWith('reply:') && s.space) {
        const m = msgs.find((x) => x.who === 'you' && x.reply?.id === id.slice('reply:'.length))
        if (m) Object.assign(m, { answered: m.answered ?? 'Answered', elsewhere: this.answeredIn(s.space) })
      }
    // a menu in the terminal shows as a question card, posted by Lineclear
    const menu = this.menus.get(key)
    if (menu && !this.openQuestion(key)) {
      const waitingAt = msgs.findIndex((m) => m.waiting)
      const card = menuCard(key, menu, from, `${CLI_NAME[kind] ?? kind} asks`)
      if (waitingAt >= 0) msgs.splice(waitingAt, 0, card)
      else msgs.push(card)
    }
    const st = this.agents.status(key)
    const failed = this.agents.failedLately(key)
    const active = this.agents.info(key)?.agent_session
    const file =
      active?.kind === 'path'
        ? r?.logs.find((f) => f.endsWith(`/${active.value.split('/').at(-1)}`))
        : r?.sessionId
          ? r.logs.find((f) => f.endsWith(`${r.sessionId}.jsonl`))
          : r?.logs.at(-1)
    const runtime = sessionRuntime(ev, file, r?.started ?? 0)
    if (runtime?.model) runtime.modelLabel = findModel(kind, runtime.model)?.label
    return {
      key,
      cli: CLI_NAME[kind] ?? kind,
      agent: r
        ? {
            runtime,
            ...launchHarness({ kind: r.kind, model: r.model, effort: r.effort }),
            ...(findModel(r.kind, r.model) ? { modelLabel: findModel(r.kind, r.model)!.label } : {}),
          }
        : undefined,
      messages: msgs,
      failed: failed.length ? failed : undefined,
      working: st === 'working' || undefined,
      background: (st === 'working' && !this.replying(key, ev)) || undefined,
      finished: (r?.finished && st === 'gone') || undefined,
      controls: this.controls(),
    }
  }
}
