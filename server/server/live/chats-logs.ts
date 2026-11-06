import { existsSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ActivityAnswer, ActivityAsk, ChatControls, Question } from '../../shared/types.ts'
import { HOME, readJson, writeJson } from '../store.ts'
import { stripHidden, type Agents, type OutItem } from './agents.ts'
import { agentLines } from './chatlines.ts'
import { herdr } from './herdr.ts'
import { capturedTranscript, privateRuntimePath } from './autopilot-sandbox.ts'
import { homedir } from 'node:os'
import { logKind } from './readers/find.ts'
import { LogTail, readerFor } from './readers/index.ts'
import type { LogEvent } from './readers/types.ts'
import type { Cut } from './retry.ts'
import { findModel, modelsOf, nearest } from './models.ts'
import { replyOnScreen } from './streaming.ts'
import { activityOf, codexThreadLog, cutOutput, headlessJob, JobLogs, lastLine, outputAt, shown as shownStep, tailOf, type JobRec } from './activity.ts'
import { yours, turnOf, replying, type Shown, type Posted, type ChatLog, safe, type ScreenMenu, parseMenu, sawReply, PIECE } from './chats-helpers.ts'

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
  protected shown = new Map<string, Shown>()
  protected jobLogs = new JobLogs()
  protected threadLogs = new Map<string, string>()
  protected jobsSeen = new Map<string, string>()

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
    for (const m of [this.tails, this.events, this.where, this.reading, this.logs, this.menus, this.menuAt, this.shown]) m.delete(key)
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
      const privateHome = f.match(/^(.*\/autopilot-runtime\/[^/]+\/[^/]+\/captures)\//)?.[1]
      if (privateHome && !privateRuntimePath(privateHome, f)) continue
      let t = this.tails.get(f)
      if (!t) {
        // each by its own CLI's reader: a backup agent's logs follow the first one's
        const reader = readerFor(logKind(f) ?? r.kind)
        if (!reader) continue
        t = new LogTail(f, reader)
        this.tails.set(f, t)
      }
      const was = t.done
      const ev = t.read(left)
      left -= Math.max(0, t.done - was)
      for (const e of ev) {
        if (privateHome && e.kind === 'job') {
          const mapped = (path?: string) =>
            path ? privateRuntimePath(privateHome, capturedTranscript(privateHome, r.kind, relative(homedir(), path))) : undefined
          e.log = mapped(e.log)
          e.output = mapped(e.output)
        }
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

  /** the newest thing in the chat from its agent (a reply you will see, its question) or Lineclear (a card, an
   *  artifact): when it came, its words, and whether it is a card about a task (whose own alert tells of it) */
  newest(key: string): { at: number; text?: string; card?: boolean } | undefined {
    this.pull(key)
    const ev = this.events.get(key) ?? []
    const e = ev.findLast((x) => (x.kind === 'agent' && agentLines(stripHidden(x.text)).text) || x.kind === 'question')
    const p = this.log(key).posted.findLast((x) => !x.who)
    const reply = e && { at: e.at, text: e.kind === 'agent' ? agentLines(stripHidden(e.text)).text : undefined }
    const posted = p && { at: p.at, text: p.card?.text ?? p.text ?? p.question?.title, card: !!p.card }
    return !reply || (posted && posted.at > reply.at) ? posted : reply
  }

  /** in a turn the agent started itself, has its reply begun on its screen, not as a hidden <no-reply> (or older [[...]])? Read about
   *  once a second, until it has; true when that changes what the chat shows */
  async readReply(key: string): Promise<boolean> {
    const r = this.agents.record(key)
    const turn = turnOf(this.events.get(key) ?? [], this.agents.sentLately(key))
    if (!r || this.agents.status(key) !== 'working' || turn.kind !== 'own') {
      const had = this.shown.get(key)?.on ?? false
      this.shown.delete(key)
      return had
    }
    const was = this.shown.get(key)
    const s: Shown = was && was.turn === turn.id ? was : { turn: turn.id!, on: false, at: 0 }
    this.shown.set(key, s)
    // a little under the poll's second, so a late tick never skips a read
    if (s.on || Date.now() - s.at < 900) return false
    s.at = Date.now()
    const info = this.agents.info(key)
    if (!info) return false
    Object.assign(s, sawReply(s, replyOnScreen(r.kind, await herdr.visible(info.pane_id).catch(() => ''))))
    return s.on
  }

  /** a blocked agent's terminal menu, or one a slash command opened, read from its screen (refreshed at most every
   *  2s) */
  async readMenu(key: string, force = false): Promise<boolean> {
    const st = this.agents.status(key)
    if (!force && (st === 'working' || st === 'gone') && !this.commandMenus.has(key)) {
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
    const parsed = st === 'blocked' || this.commandMenus.has(key) || waiting ? parseMenu(text) : null
    const m = parsed
      ? { ...parsed, screen: parsed.screen ?? text.trim() }
      : st === 'blocked' && text.trim()
        ? { title: 'The terminal is waiting for you', choices: [], cursor: 0, screen: text.trim() }
        : null
    const before = JSON.stringify(this.menus.get(key) ?? null)
    if (m) this.menus.set(key, m)
    else this.menus.delete(key)
    // the command's menu is answered: what you wrote meanwhile goes in
    if (!m && this.commandMenus.delete(key)) void this.agents.deliver(key)
    return before !== JSON.stringify(m)
  }

  /** menus a slash command opened that herdr doesn't see as blocking the agent: shown as a card all the same, and what
   *  you write waits for them like for any menu */
  protected commandMenus = new Set<string>()

  /** a slash command opened a menu: read it as a card; true when there is one */
  async commandMenu(key: string) {
    this.commandMenus.add(key)
    await this.readMenu(key, true).catch(() => false)
    if (!this.menus.has(key)) this.commandMenus.delete(key)
    return this.menus.has(key)
  }

  /** a menu a slash command opened is up */
  commandMenuUp(key: string) {
    return this.commandMenus.has(key) && this.menus.has(key)
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

  /** what cut off the agent's last turn (its provider failed), when nothing began since; never one from before it last
   *  started (started again, or a backup agent that took over, whose own log has nothing yet) */
  cutOff(key: string): Cut | undefined {
    this.pull(key)
    const ev = this.events.get(key) ?? []
    const e = ev.findLast((e) => e.kind === 'error' || e.kind === 'turn-start' || e.kind === 'user')
    if (e?.kind !== 'error' || e.at < (this.agents.record(key)?.started ?? 0)) return undefined
    return { id: e.id, at: e.at, text: e.text, code: e.code, status: e.status }
  }

  /** its log shows a turn that ended after this time */
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

  /* ---------- what it does: its steps, and its work in the background ---------- */

  /**
   * What it started in the background that still runs, each with what it does now: what its log started and didn't
   * say is over, and the headless agents it runs. Nothing once it is gone; with Claude Code, nothing once its turn is
   * over and its session says nothing runs (a log may miss an end).
   */
  jobs(key: string, act = activityOf(this.events.get(key) ?? [])): JobRec[] {
    const st = this.agents.status(key)
    if (st === 'gone') return []
    const r = this.agents.record(key)
    let list = act.jobs.map((j) => ({ ...j }))
    if (r?.kind === 'claude' && st !== 'working' && st !== 'blocked' && !this.agents.stillRuns(key)) list = []
    const heads = this.agents.reviewers.list(key).map((h) => headlessJob(h, r?.logs ?? []))
    // a headless agent run as a background shell is the agent, once
    if (heads.length) list = list.filter((j) => j.kind !== 'shell' || !/\b(codex (exec|e)|(claude|pi)\b.* (-p|--print))\b/.test(j.title))
    list.push(...heads)
    for (const j of list) {
      if (j.kind === 'agent' && !j.log && r?.kind === 'codex' && !r.isolation) {
        const f = this.threadLogs.get(j.id) ?? codexThreadLog(j.id)
        if (f) this.threadLogs.set(j.id, (j.log = f))
      }
      if (j.log) j.more = 'steps'
      j.now = j.log ? this.jobLogs.now(j.log) : j.output ? lastLine(j.output) : undefined
    }
    return list
  }

  /** what runs in the background changed since it was last asked (a pass of the watched chats): a job came or went,
   *  or one does something else now */
  jobsChanged(key: string): boolean {
    this.pull(key)
    const sig = JSON.stringify(this.jobs(key).map((j) => [j.id, j.now]))
    if (this.jobsSeen.get(key) === sig) return false
    this.jobsSeen.set(key, sig)
    return true
  }

  /** what the screen opens: a turn's steps, a step's raw output, a background job's own steps or output */
  activity(a: ActivityAsk): ActivityAnswer {
    this.pull(a.chat)
    const act = activityOf(this.events.get(a.chat) ?? [])
    const turns = [...act.turns, ...(act.open ? [act.open] : [])]
    if (a.what === 'turn') {
      const t = turns.find((x) => x.id === a.id)
      if (!t) return { error: 'That turn is no longer in its log.' }
      return { steps: t.steps.slice(-300).map(shownStep), more: t.steps.length > 300 ? t.steps.length - 300 : undefined }
    }
    if (a.what === 'output') {
      const s = turns.flatMap((t) => t.steps).find((x) => x.id === a.id)
      const out = s?.where && outputAt(s.where, s.id)
      return out === undefined || out === '' ? { error: s?.where ? 'It printed nothing.' : 'Its output is not in its log.' } : cutOutput(out)
    }
    const j = this.jobs(a.chat, act).find((x) => x.id === a.id)
    if (!j) return { error: 'That is over now.' }
    if (j.log) return this.jobLogs.steps(j.log)
    const tail = j.output && tailOf(j.output)
    return tail === undefined || tail === '' ? { error: 'Nothing to show for it yet.' } : cutOutput(tail)
  }

  protected replying(key: string, ev: LogEvent[]) {
    const turn = turnOf(ev, this.agents.sentLately(key))
    const s = this.shown.get(key)
    return replying(turn, !!s?.on && s.turn === turn.id, ev)
  }

  protected controls(key: string, kind: string): ChatControls {
    // only Claude Code changes model and effort mid-session (/model, /effort); Codex and pi change them only through
    // their own pickers: their menu only adds files
    const c = kind === 'claude' ? modelsOf(kind) : undefined
    const r = this.agents.record(key)
    const on = findModel(kind, r?.model) ?? c?.models[0]
    if (!c || !on) return { models: [], model: 0, efforts: [], effort: 0 }
    // the models it offers, and an older one it was started on (--model model-top-4-8) as well
    const models = c.models.some((m) => m.id === on.id) ? c.models : [...c.models, on]
    // the level it runs at: a level this model lacks shows as the nearest it has, as it goes in
    const effort = nearest(on.efforts, r?.effort) ?? on.effort ?? on.efforts[0]
    return { models: models.map((m) => m.label), model: models.indexOf(on), efforts: on.efforts, effort: Math.max(0, on.efforts.indexOf(effort ?? '')) }
  }
}
