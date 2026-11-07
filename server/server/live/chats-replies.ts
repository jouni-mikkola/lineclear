import { cardMessage, type Chat, type Message, type Reaction } from '../../shared/types.ts'
import { stripHidden } from './agents.ts'
import { agentLines, excerpt, findQuoted, parseReply, parseUserLine, userLines } from './chatlines.ts'
import { findModel } from '../../../src/models.ts'
import { sessionRuntime } from './runtime.ts'
import { launchHarness } from './restart.ts'
import { CLI_NAME } from './settings.ts'
import { shownAs, words, replied, hostFor } from './chats-helpers.ts'
import { menuId } from './chat-menu.ts'
import { withAnswer } from './chat-store.ts'
import { ChatsLogs } from './chats-logs.ts'

export class ChatsReplies extends ChatsLogs {
  /* ---------- the chat as the screen draws it ---------- */

  chat(key: string): Chat {
    this.pull(key)
    const r = this.agents.record(key)
    const kind = r?.kind ?? 'claude'
    const _user = this.user()
    const from = this.nameOf(key)
    const ev = this.events.get(key) ?? []
    const l = this.log(key)
    const msgs: Message[] = []
    const answered = new Set(ev.filter((e) => e.kind === 'answered').map((e) => e.id))
    // a file is named by its path (two may share a name); one quoted by its name alone is the latest of that name
    const byText = (quoted: string, path?: string) => findQuoted(msgs, quoted, path)
    /** a reply's quote of the message it answers: that message when it is still in the chat, else the quote alone */
    const replyTo = (quoted: string, path?: string, line?: string): Message['reply'] => {
      const id = line && replied.get(words(line))
      const m = (id && msgs.find((x) => x.id === id)) || byText(quoted, path)
      if (!m) return { text: quoted.replace(/”/g, '"') }
      return { id: m.id, who: m.who, text: m.text ? excerpt(m.text, 160) : (m.file?.name ?? ''), ...(m.text ? {} : { file: true }) }
    }
    const addRx = (m: Message | undefined, emoji: string, who: 'me' | 'them', on: boolean, pending = false) => {
      if (!m) return
      const rx = (m.reactions ??= [])
      const i = rx.findIndex((x) => x.emoji === emoji)
      const cur = i >= 0 ? rx[i].by : undefined
      let next: Reaction['by'] | undefined
      if (on) next = cur && cur !== who ? 'both' : who
      else next = cur === 'both' ? (who === 'me' ? 'them' : 'me') : cur === who ? undefined : cur
      if (i >= 0) rx.splice(i, 1)
      if (next) rx.splice(i >= 0 ? i : rx.length, 0, { emoji, by: next, ...(pending ? { pending } : {}) })
    }
    // what you sent from a screen gets the screen's id back, so the screen swaps the message it showed at once for it:
    // the same words, read from the log once they went in
    const lately = this.agents.sentLately(key).map((o) => ({ cid: o.cid!, at: o.at, words: words(stripHidden(o.text)) }))
    const cidFor = (text: string, at: number) => {
      const i = lately.findIndex((o) => at >= o.at - 3000 && o.words === words(text))
      return i < 0 ? undefined : lately.splice(i, 1)[0].cid
    }
    // Lineclear's update cards are messages too, among the rest by time, so a reaction can quote one
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
        // a reply: its words, then its files
        const r = parseReply(text)
        const reply = r ? replyTo(r.to, undefined, r.line) : undefined
        const lines = r ? [...userLines(r.text), ...r.rest] : userLines(text)
        const files: { name: string; path: string }[] = []
        const rest: string[] = []
        let answeredTitle: string | undefined
        let consumed = false
        for (const ln of lines) {
          const p = parseUserLine(ln)
          if (!p) {
            rest.push(ln)
            continue
          }
          if (p.kind === 'attach') files.push({ name: p.name, path: p.path })
          else if (p.kind === 'react' || p.kind === 'unreact') {
            addRx(byText(p.to, p.path), p.emoji, 'me', p.kind === 'react')
            consumed = true
          } else {
            const s = shownAs(p)!
            answeredTitle = s.title ?? answeredTitle
            rest.push(s.text)
          }
        }
        const body = rest.join('\n').trim()
        if (consumed && !body && !files.length) continue
        const cid = answeredTitle ? undefined : cidFor(text, e.at)
        if (body || answeredTitle)
          msgs.push({ id: e.id, who: 'you', at: e.at, text: body || undefined, answered: answeredTitle, cid, newSession: newSession || undefined, reply })
        // each file is a message of its own, right after the text (the first one keeps the message's own id, and a
        // reply with no words)
        files.forEach((file, i) =>
          msgs.push({
            id: i || body || answeredTitle ? `${e.id}:${i}` : e.id,
            who: 'you',
            at: e.at,
            file,
            cid,
            newSession: (!i && !body && !answeredTitle && newSession) || undefined,
            reply: !i && !body && !answeredTitle ? reply : undefined,
          }),
        )
        newSession = false
        continue
      }
      if (e.kind === 'agent') {
        const { text, reactions, reply } = agentLines(stripHidden(e.text))
        for (const x of reactions) addRx(byText(x.to, x.path), x.emoji, 'them', true)
        if (!text) continue
        msgs.push({ id: e.id, who: 'agent', at: e.at, text, newSession: newSession || undefined, reply: reply ? replyTo(reply.to, reply.path) : undefined })
        newSession = false
        continue
      }
      if (e.kind === 'question') {
        e.items.forEach((it, i) => {
          const qid = e.items.length > 1 ? `${e.id}:${i}` : e.id
          const sent = l.answers[qid] ?? (answered.has(e.id) ? -1 : undefined)
          // not picked here and no words typed on the card: answered in the terminal
          const said = sent === -1 ? l.said?.[qid]?.text : undefined
          const space = l.said?.[qid]?.space
          msgs.push({
            id: `${e.id}#${i}`,
            who: 'agent',
            at: e.at + i,
            question: {
              id: qid,
              title: it.question,
              kind: 'Question',
              choices: it.options,
              multi: it.multiSelect,
              other: it.allowCustom,
              to: from,
              sent: sent === undefined ? undefined : sent,
              said,
              via: sent === -1 && !said ? 'terminal' : undefined,
              elsewhere: space ? this.answeredIn(space) : undefined,
            },
          })
        })
      }
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
      if (o.reaction) {
        const m = msgs.find((x) => x.id === o.reaction!.message)
        addRx(m, o.reaction.emoji, 'me', parseUserLine(o.text)?.kind !== 'unreact', true)
      } else {
        const files: { name: string; path: string }[] = []
        const r = parseReply(o.text)
        const reply = r ? replyTo(r.to, undefined, r.line) : undefined
        let answered: string | undefined
        const text = stripHidden(
          (r ? [...userLines(r.text), ...r.rest] : userLines(o.text))
            .flatMap((ln) => {
              const p = parseUserLine(ln)
              if (p?.kind === 'attach') files.push({ name: p.name, path: p.path })
              const s = p && shownAs(p)
              if (s?.title) answered = s.title
              return p?.kind === 'attach' ? [] : [s ? s.text : ln]
            })
            .join('\n'),
        )
        // what Lineclear itself sends (instructions, news) never shows as yours
        if (text || answered) msgs.push({ id: o.id, who: 'you', at: o.at, text: text || undefined, answered, waiting: true, waitsFor, cid: o.cid, reply })
        files.forEach((file, i) =>
          msgs.push({ id: `${o.id}:${i}`, who: 'you', at: o.at, file, waiting: true, waitsFor, cid: o.cid, reply: !i && !text ? reply : undefined }),
        )
      }
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
      const card: Message = {
        id: menuId(key, menu),
        who: 'agent',
        at: Date.now(),
        question: {
          id: menuId(key, menu),
          title: menu.title,
          screen: menu.screen,
          terminal: true,
          noNote: true,
          multi: menu.multi,
          reject: menu.reject,
          kind: 'Form',
          choices: menu.choices.map((label, i) => ({ label, description: menu.descriptions?.[i] })),
          to: from,
          asks: `${CLI_NAME[kind] ?? kind} asks`,
        },
      }
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
