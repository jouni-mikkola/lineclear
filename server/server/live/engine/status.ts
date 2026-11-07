import type { Engine } from './engine.ts'
import type { TaskStatus } from '../../../shared/types.ts'
import { CLI_NAME } from '../settings.ts'
import * as Lane from './lane.ts'
import { askOf, fitStatus } from './status-line.ts'
import { type TaskRec, loginGone, ended, HELD } from './engine-helpers.ts'

/** what a task that waits on you shows instead of its agent's message: a few words on why, never the message itself */
export const NEED = {
  plan: 'Plan to approve',
  permission: 'Asks permission',
  login: 'Signed out',
  question: 'Question for you',
  reply: 'Waits for your reply',
} as const

export class EngineStatus {
  constructor(private readonly e: Engine) {}

  /** the one status the task list, the task's own chat, the place dots and the command all show */
  statusOf(t: TaskRec): TaskStatus {
    const status = this.rawStatus(t)
    // Needs you means a question: a turn that ended with none is resumed by the stall ladder, so it reads as work
    if (status !== 'silent') return status
    return t.paused || t.stopped ? 'need' : 'work'
  }

  /** statusOf before a quiet end reads as work: 'silent' is a turn that ended with no question, plan, login or failure */
  rawStatus(t: TaskRec): TaskStatus | 'silent' {
    if (ended(t)) return 'done'
    if (t.trouble) return 'need'
    if (t.stuck) return 'work'
    const key = this.e.key(t)
    const st = this.e.agents.status(key)
    // an open card or CLI question of a turn that is over; once its agent works again it went on without the answer
    if (st === 'blocked' || (this.e.asks(key) && st !== 'working')) return 'need'
    // queued: until they are all done, or one ends without being done (then it waits for you to decide)
    if (this.e.startPart.queued(t)) return this.e.startPart.halts(t).length ? 'need' : 'queued'
    // held until the machine has room
    if (this.e.startPart.holding(t)) return 'queued'
    if (t.todo || this.e.inPhase(t, 'starting') || this.e.inPhase(t, 'briefing')) return 'todo'
    // on its way into main, nothing for you to do: unless its agent stopped to ask you something (then it is Ready)
    if (t.reported && t.landing && (st === 'working' || !this.e.asks(key))) return 'merging'
    if (st === 'working' || this.e.inPhase(t, 'handing')) return 'work'
    if (this.e.agents.waiting(key).length || this.e.answering.has(t.id)) return 'work'
    // a stopped turn is not a finished one
    if (t.reported) return this.e.agents.aborted(key) ? 'silent' : 'ready'
    // its turn ended (or it stopped) without reporting done: it waits for you, if it asks something
    return this.reasonOf(key) === undefined ? 'silent' : 'need'
  }

  /**
   * the second line of a list row: what the status is about, in one short standard line, never the brief. While it
   * works, its agent's own status line (lineclear status) takes its place on screen and in the CLI (source.ts).
   */
  subOf(t: TaskRec, status = this.e.statusOf(t)): string {
    const key = this.e.key(t)
    const s = (() => {
      // a few words, never the summary: that is in its chat's card
      if (status === 'done') return t.closed ? 'Nothing to merge' : 'Merged'
      if (status === 'need' && (this.e.agents.status(key) === 'blocked' || this.e.asks(key))) return this.reasonOf(key) ?? NEED.question
      if (t.stuck) return fitStatus(`May be stuck: ${t.stuck}`)
      if (t.trouble) return fitStatus(`Went wrong: ${t.trouble}`)
      // a To do row is its title alone
      if (status === 'todo') return ''
      if (status === 'queued') return this.e.startPart.holding(t) ? HELD[t.held!.why] : this.e.startPart.waitLine(t)
      if (status === 'need' && this.e.startPart.queued(t) && this.e.agents.status(key) !== 'blocked') return fitStatus(this.e.startPart.halts(t).join(' · '))
      if (status === 'need') return this.reasonOf(key) ?? NEED.reply
      if (status === 'ready') return 'Ready to merge'
      if (status === 'merging') return Lane.landingLine(t.landing!, t.base)
      if (this.e.inPhase(t, 'handing') && t.tookOver) return fitStatus(`${CLI_NAME[t.tookOver.to] ?? t.tookOver.to} takes over: ${t.tookOver.why}`)
      return 'Working'
    })()
    return s.length > 90 ? `${s.slice(0, 89).trimEnd()}…` : s
  }

  /**
   * why its agent waits on you: a standard reason, or the agent's own question cut to a status line. From what the agent
   * reports (its log, its cards), never a model's reading of it.
   */
  reasonOf(key: string): string | undefined {
    if (this.e.agents.status(key) === 'blocked') {
      const q = this.e.chats.openQuestion(key)
      if (q) return fitStatus(q.items[0]?.question ?? '') || NEED.question
      return loginGone(this.e.chats.menu(key)?.title) ? NEED.login : NEED.permission
    }
    const card = this.e.chats.openCard(key)
    if (card) return card === 'plan' ? NEED.plan : fitStatus(this.e.chats.openCardTitle(key) ?? '') || NEED.question
    const question = this.e.chats.openQuestion(key)
    if (question) return fitStatus(question.items[0]?.question ?? '') || NEED.question
    const last = this.e.chats.lastReply(key)
    if (loginGone(last)) return NEED.login
    return askOf(last)
  }
}
