import { exists } from '../mfs.ts'
import type { Question } from '../../../shared/types.ts'
import { hidden } from '../agents.ts'
import { restartLine, resumedLine, taskFirst } from '../prompts.ts'
import { CLI_NAME } from '../settings.ts'
import { fitHarness, harnessWords, recentChat } from '../restart.ts'
import * as G from './git.ts'
import { unmerged } from './branch-work.ts'
import * as Lane from './lane.ts'
import { fitStatus } from './status-line.ts'
import { type TaskRec, type Harness, ended, labelOf, ghNow } from './engine-helpers.ts'
import { EnginePr } from './engine-pr.ts'
import { move } from './phase.ts'

export class EngineHandoff extends EnginePr {
  /** writing to a task whose agent stopped starts it again, with its memory */
  resume(id: string) {
    const t = this.task(id)
    if (t?.stuck && !t.worktree && !ended(t)) {
      this.startTask(t).catch((e) => this.troubled(t, e))
      return Promise.resolve(null)
    }
    if (!t?.worktree) return Promise.resolve(null)
    return this.launch(t)
  }

  /**
   * Its agent started again on this CLI, model and effort (the restart sheet, lineclear restart). Mid-turn it is
   * interrupted first. The same CLI resumes its session; another takes over with the brief, the branch's commits,
   * what lies uncommitted and the chat's last messages. What you sent meanwhile waits for it; its worktree and branch
   * stay as they are; a card in its chat marks it.
   */
  async restart(id: string, to: Harness) {
    const t = this.req(id)
    if (ended(t)) throw new Error(this.overWords(t))
    if (!t.worktree) throw new Error(`${t.id} hasn't started yet: it starts on what its brief says.`)
    if (this.inPhase(t, 'handing')) throw new Error(`${t.id}'s agent is starting again already.`)
    if (!this.installed(to.kind)) throw new Error(`${CLI_NAME[to.kind] ?? to.kind} isn't installed on this machine.`)
    const key = this.key(t)
    const h = fitHarness(to)
    const from = this.agents.record(key)?.kind ?? t.agent?.kind ?? ''
    const name = (k: string) => CLI_NAME[k] ?? k
    const words = harnessWords(h)
    if (!move(t, 'handoff')) throw new Error(`${t.id} is busy: try again in a moment`)
    try {
      // what it is told, read once its turn has stopped: what it did meanwhile counts
      const first = async () => {
        await this.agents.stopTurn(key)
        if (from === h.kind) return hidden(resumedLine(words), 'restart')
        return hidden(`${taskFirst(t)}\n\n${restartLine({ from: name(from), to: words, ...(await this.soFar(t, key, name(from))) })}`, 'restart')
      }
      await this.launch(t, undefined, undefined, { ...h, model: h.model ?? '', effort: h.effort ?? '' }, first)
      // a pause or a stop is over: it carries on
      t.stopped = undefined
      t.paused = undefined
      t.agent = h
      const card = `restart:${t.id}:${Date.now()}`
      this.chats.post(key, { id: card, card: { id: card, restart: true, text: `Restarted on ${words}` } })
    } finally {
      move(t, 'over')
      this.save()
      this.settle(t)
    }
    return words
  }

  /** something went in to an agent: its brief, maybe, which it may already be at work on */
  sent(key: string) {
    const t = this.task(key.split('/')[0])
    if (!t || !this.inPhase(t, 'briefing')) return
    this.begun(t)
    this.settle(t)
  }

  /** what a backup agent is told was done: the branch's commits, what lies uncommitted, the chat's last messages */
  protected async soFar(t: TaskRec, key: string, them: string) {
    const out = async (...args: string[]) => {
      const r = await G.git(t.worktree!, ...args)
      return r.ok ? r.out.split('\n').filter(Boolean).slice(0, 20).join('\n') : ''
    }
    return {
      commits: await out('log', '--oneline', `${t.base}..HEAD`),
      changes: await out('status', '--short'),
      chat: recentChat(this.chats.chat(key).messages, them, taskFirst(t).trim()),
    }
  }

  /* ---------- what agents report ---------- */

  /** the agent's plan: a card in its chat; your answer goes back to it as a chat line */
  async plan(id: string, steps: string[]) {
    const t = this.req(id)
    t.plan = steps
    const q: Question = {
      id: `plan:${t.id}:${Date.now()}`,
      title: `Plan for ${t.id}`,
      kind: 'Plan',
      steps,
      choices: [{ label: 'Approve the plan' }, { label: 'Send it back with a note' }],
      noteRequiredFor: 1,
      to: `${t.id} agent`,
    }
    this.chats.post(this.key(t), { id: q.id, question: q })
    this.save()
  }

  /** the agent's own progress (lineclear status): its line, how far through the task, the minutes left if it said */
  report(id: string, msg: string, progress: number, left?: number) {
    const t = this.req(id)
    if (ended(t)) throw new Error(`${t.id} is Done already (${t.closed ? 'nothing to merge' : 'merged'})`)
    // reported done: nothing shows, and a line kept now would come back stale once it works again
    if (t.reported) throw new Error(`${t.id} is Ready: no progress shows until it works again.`)
    const at = Date.now()
    this.heard.set(t.id, at)
    t.report = { msg: fitStatus(msg), progress, left, at, pausedAt: this.statusOf(t) === 'need' ? at : undefined }
    this.save()
    return t.report
  }

  /** a heartbeat from the extension while the agent's tool call runs: a sign of life, nothing more */
  alive(id: string, at = Date.now()) {
    this.beat.set(this.req(id).id, at)
  }

  /**
   * The agent reports done: Ready, waiting for review or merge. A branch with no changes at all (a research task, an
   * answer) has nothing to merge: it is closed, Done at once, and put away once the agent's turn ends.
   */
  async done(id: string, summary: string, facts?: string): Promise<'ready' | 'closed' | 'ended'> {
    const t = this.req(id)
    if (ended(t)) return 'ended'
    // the gates that run no test would fail the merge check: the agent hears them now, not after a turn in the lane
    const gates = t.worktree && t.base && (await exists(t.worktree)) ? await Lane.fastGatesFailure(t.worktree, t.base) : undefined
    if (gates)
      throw new Error(
        `Not ready: the check's fast gates fail on this branch, so nothing was reported. Fix them, commit, then run lineclear ready ${t.id} again.\n${gates}`,
      )
    if (summary) t.said = summary
    if (facts) t.facts = facts
    t.reported = true
    t.landCard = t.landTriedAt = undefined
    t.reportedAt ??= Date.now()
    t.landing = undefined
    t.going = undefined
    // news on its pull request from now on is told to it
    t.watch ??= { since: ghNow() }
    // its job is over: so is what it said of its progress
    t.report = undefined
    if (t.worktree && t.base && (await exists(t.worktree)) && !(await G.dirty(t.worktree)) && (await G.aheadCount(t.worktree, t.base)) === 0) {
      this.markClosed(t, 'done')
      if (this.agents.status(this.key(t)) !== 'working') await this.cleanup(t)
      return 'closed'
    }
    this.save()
    // told once its turn ends: an agent that merges right after never shows as waiting
    this.settleSoon(t)
    // its pull request gets the summary and is ready for review; GitHub away changes nothing here
    if (t.pr && !t.merged) this.readyForReview(t).catch(() => undefined)
    return 'ready'
  }

  protected markClosed(t: TaskRec, by: 'done' | 'close') {
    Object.assign(t, {
      closed: true,
      closedBy: by,
      doneAt: Date.now(),
      reported: true,
      landing: undefined,
      trouble: undefined,
      stopped: undefined,
      todo: undefined,
    })
    clearTimeout(this.later.get(t.id))
    this.settle(t)
    this.dropEndedOutbox()
  }

  /** whether this agent's task is done or closed */
  endedKey(key: string) {
    const t = this.task(key.split('/')[0])
    return !!t && key === this.key(t) && ended(t)
  }

  /** the refusal for a message to a task that is over, naming its state */
  overWords(t: TaskRec) {
    return `${t.id} is Done already (${t.closed ? 'nothing to merge' : 'merged'}): it has no agent, so nothing is sent to it.`
  }

  /** what waited for an agent of a task that is over is dropped: it would be retried for ever */
  dropEndedOutbox() {
    this.agents.dropOutboxWhere?.((key) => this.endedKey(key))
  }

  /**
   * Close a task with nothing to merge: Done with its summary (what it said when ready, else "Nothing to merge"). Its agent
   * stops and its space closes; its worktree and branch go when they hold nothing unsaved or unmerged, else they are
   * kept and said so. A branch with commits main lacks is refused (and its agent told) unless the human chose to discard.
   */
  async close(id: string, summary?: string, facts?: string, discard = false): Promise<{ kept: string[] }> {
    const t = this.req(id)
    if (ended(t)) throw new Error(`${t.id} is Done already (${t.closed ? 'nothing to merge' : 'merged'})`)
    const key = this.key(t)
    // a branch with commits only here is no "nothing to merge": the task goes back to its agent
    const p = this.places.space(t.project) && this.proj(t)
    const left = !discard && p && t.branch ? await this.onMachineOf(t, () => unmerged(p.path, t.branch!, t.base ?? p.base, t.id)) : 0
    if (left) {
      const why = `${t.branch} has ${left} commit${left === 1 ? '' : 's'} ${t.base ?? p?.base} lacks, so ${t.id} is not Done with nothing to merge: finish it with ready, and merge it.`
      await this.agents.send(key, why, { ensure: () => this.launch(t) }).catch(() => undefined)
      throw new Error(why)
    }
    if (this.agents.status(key) === 'working') await this.agents.interrupt(key)
    if (summary) t.said = summary
    if (facts) t.facts = facts
    this.markClosed(t, 'close')
    // putting it away closes the agent too, after looking at its work
    return { kept: (await this.cleanup(t, true))?.kept ?? [] }
  }

  /** what a task's worktree and branch hold that its base lacks, in words ("~/x (uncommitted changes)"); none: nothing is lost */
  async holds(t: TaskRec): Promise<string[]> {
    if (!this.places.space(t.project)) return []
    const p = this.proj(t)
    const on = t.base ?? p.base
    return this.onMachineOf(t, async () =>
      this.wtOf(t).holds({ repo: p.path, wt: t.worktree, branch: t.branch, base: on, squashes: await this.squashes(t, p.path, on) }),
    )
  }

  /**
   * Pause a working task: its agent is interrupted mid-work (as Esc does; it stays alive) and the task is To do, as
   * with lineclear todo, until something is written to it. Its work, worktree and chat stay.
   */
  async pause(id: string) {
    const t = this.req(id)
    if (this.statusOf(t) !== 'work') throw new Error(`${t.id} isn't working: only a working task is paused`)
    // To do first: the turn the interrupt ends is no question for you
    t.todo = true
    t.paused = this.agents.status(this.key(t)) === 'working' ? 'sent' : 'idle'
    clearTimeout(this.later.get(t.id))
    await this.agents.interrupt(this.key(t))
    this.settle(t)
    return t
  }

  /**
   * Put a finished task's place away: agent, space, worktree and branch, keeping whatever holds unsaved or unmerged
   * work (said in news, and in lineclear status). Marked cleaned only once done, so one cut short (a restart) or put
   * off (something still runs in its space) is tried again.
   */
  protected async cleanup(t: TaskRec, quiet = false) {
    const p = this.places.space(t.project)
    if (!p || !move(t, 'clean')) return
    try {
      const r = await this.putAway(t, p.path, p.base)
      if (r.busy) return r
      const news = r.kept.length && JSON.stringify(r.kept) !== JSON.stringify(t.kept)
      t.kept = r.kept.length ? r.kept : undefined
      t.cleaned = true
      this.save()
      if (news && !quiet)
        this.emit('news', t.project, `${t.id} ${t.closed ? 'is done, nothing to merge' : 'was merged'}; kept ${r.kept.join(', ')}`, 'done', {
          task: t.id,
          event: t.closed ? 'closed' : 'merged',
        })
      return r
    } finally {
      move(t, 'over')
    }
  }

  /** a merged task's branch is checked against its squash merge: the one recorded, else (merged before one was) the
   *  commits its subject names */
  protected async putAway(t: TaskRec, repo: string, base: string) {
    const key = this.key(t)
    const on = t.base ?? base
    return this.onMachineOf(t, async () =>
      this.wtOf(t).putAway({
        repo,
        wt: t.worktree,
        branch: t.branch,
        base: on,
        squashes: await this.squashes(t, repo, on),
        label: labelOf(t),
        agentPane: this.agents.info(key)?.pane_id,
        closeAgent: () => this.agents.finish(key),
      }),
    )
  }

  protected async squashes(t: TaskRec, repo: string, on: string) {
    return !t.merged ? [] : t.squash ? [t.squash] : G.squashesOf(repo, on, t.id)
  }
}
