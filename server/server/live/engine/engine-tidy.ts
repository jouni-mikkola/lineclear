import { exists } from '../mfs.ts'
import type { TaskStatus } from '../../../shared/types.ts'
import { ROUTING_FAILURE } from '../agents.ts'
import { splitBrief } from '../prompts.ts'
import { type TaskRec, ended, labelOf, archiveAfterMs } from './engine-helpers.ts'
import { EngineMerge } from './engine-merge.ts'
import { move } from './phase.ts'
import { retireDue } from './retire.ts'
import * as Lane from './lane.ts'
import { killWork, workIn } from './machine.ts'
import { decide } from './lane-watch.ts'

export class EngineTidy extends EngineMerge {
  /** Lets go of the heads that show no progress or hold their line past its limit: the next head starts, the task is told. */
  async watchHeads(now = Date.now()) {
    const look = this.headWatch.look(
      now,
      (id) => this.task(id)?.landing?.step,
      (dirs) => workIn(dirs),
    )
    for (const r of look) {
      const t = this.task(r.id)
      const repo = t && this.places.space(t.project)?.path
      if (!t || !repo) continue
      const step = t.landing ? Lane.landingLine(t.landing, t.base) : 'Merging'
      const twice = (this.released.get(t.id) ?? 0) >= 1
      this.released.set(t.id, (this.released.get(t.id) ?? 0) + 1)
      const hung = `Your merge hung in "${step}" for ${r.minutes} min (${r.why}), so the merge lane released it and nothing was merged.`
      decide(
        t.id,
        'stall',
        `${twice ? 'restarted' : 'released'} ${t.id}'s merge: hung in "${step}" for ${r.minutes} min, ${r.why}${twice ? ', twice in a row' : ''}`,
      )
      // the work it left running ends, so nothing it still does reaches main or the line; only this task's own folder is
      // touched: the repo's main checkout is shared
      const run = this.runOf.get(t.id)
      if (run !== undefined) this.cut.add(run)
      this.headWatch.end(t.id)
      killWork(t.worktree ? [t.worktree] : [])
      this.land(t)
      t.mergeStopped = hung.slice(0, 300)
      this.save()
      const error = `${hung} Run lineclear merge ${t.id} again.`
      // the next head starts before anyone is told: a slow message holds nothing
      this.frees.get(t.id)?.({ ok: false, error: `${error} Sent back to ${t.id}'s agent.`, freed: true })
      if (twice) {
        // the stall ladder's restart rung: stop it, then tell it
        await this.stopTask(t.id).catch(() => undefined)
        await this.tell(t.id, `${error} Your agent was restarted because this is the second release in a row.`).catch(() => undefined)
      } else await this.sendBack(t, error)
    }
  }

  /* ---------- you and coordinators ---------- */

  /**
   * A message to a task (task tell, or yours in its chat). `gate`: a coordinator's go to a task that waits (To do, or
   * held) waits for room on this machine; it says so. Yours always goes in at once. One queued after other tasks gets
   * it at once and stays queued: its agent clears the queue itself if the words are a go.
   */
  async tell(id: string, text: string, { gate = false } = {}): Promise<{ held?: 'slots' | 'machine' }> {
    const t = this.req(id)
    // refused before any herdr call: a Done task has no pane
    if (ended(t)) throw new Error(this.overWords(t))
    const waits = this.statusOf(t) === 'todo' || this.holding(t)
    const r: { why?: 'slots' | 'machine'; machine?: string } = gate && waits && !ended(t) ? this.roomFor(t) : {}
    if (r.why) {
      if (!t.worktree) {
        // its brief takes the words, as below; it starts on it once there's room
        const [work, how] = splitBrief(t.desc)
        t.desc = [work, text, how].filter(Boolean).join('\n\n')
        this.hold(t, r.why)
      } else this.hold(t, r.why, { text: t.held?.go ? `${t.held.go}\n\n${text}` : text, why: 'its coordinator said go', plain: true })
      return { held: r.why }
    }
    if (!t.worktree && !this.inPhase(t, 'starting')) {
      // above the defaults Lineclear ended the brief with, so it wins over them like the rest of the brief
      const [work, how] = splitBrief(t.desc)
      t.desc = [work, text, how].filter(Boolean).join('\n\n')
      // a message is the go, as for one at work
      t.held = undefined
      if (r.machine) t.machine = r.machine
      await this.startTask(t)
      return {}
    }
    await this.agents.send(this.key(t), text, { ensure: () => this.launch(t) })
    this.youWrote(this.key(t))
    return {}
  }

  /** a task held before it ever started: it has no agent yet, so what you write starts it (tell) */
  unstarted(id: string) {
    const t = this.task(id)
    return !!t && !t.worktree && !this.inPhase(t, 'starting') && !ended(t)
  }

  /**
   * Stop a task: its agent and its herdr space close. Its work stays: a worktree with unsaved or unmerged work is kept,
   * one with none goes with its branch. Writing to it again opens its space (or makes its worktree) and resumes it.
   */
  async stopTask(id: string): Promise<string[]> {
    const t = this.req(id)
    t.stopped = true
    move(t, 'brief-over')
    this.settle(t)
    const key = this.key(t)
    await this.agents.interrupt(key)
    // closed before anything is looked at, so it changes nothing more
    await this.agents.finish(key)
    const p = this.places.space(t.project) && this.proj(t)
    if (!p || !t.worktree || ended(t) || !move(t, 'clean')) return []
    try {
      return (await this.putAway(t, p.path, p.base)).kept
    } finally {
      move(t, 'over')
    }
  }

  /**
   * Delete a task for good (only when the human plainly asks): its agent stops, its herdr space closes, its worktree
   * and branch go, its chat log and its record too, so it leaves every list. Nothing is posted. Refused while its
   * worktree or branch holds work its base lacks, unless forced; a merged task's commits stay on main. Returns what
   * could not be removed.
   */
  async deleteTask(id: string, opts: { force?: boolean } = {}): Promise<string[]> {
    const t = this.req(id)
    if (this.inPhase(t, 'starting') || this.inPhase(t, 'cleaning')) throw new Error(`${t.id} is starting or being put away: try again in a moment`)
    const p = this.places.space(t.project) && this.proj(t)
    const key = this.key(t)
    // a merge under way in its repo goes first: never its worktree removed under it
    if (p) await this.merging.get(p.path)
    if (!this.task(t.id)) throw new Error(`No task ${id}`)
    const holds = async (stopped = '') => {
      if (opts.force) return
      const held = await this.holds(t)
      // what it holds goes with the error too, for the screen to ask whether to lose it
      if (held.length)
        throw Object.assign(
          new Error(`Not deleted: ${t.id} holds ${held.join(', ')}.${stopped} Merge or save that work first, or delete with --force to lose it.`),
          { held, stopped: !!stopped },
        )
    }
    await holds()
    if (!move(t, 'clean')) throw new Error(`${t.id} is busy: try again in a moment`)
    try {
      await this.agents.interrupt(key)
      await this.agents.finish(key)
      // its agent may have written something before it closed: it stays stopped, and writing to it resumes it
      await holds(' Its agent was stopped (writing to it starts it again).').catch((e) => {
        t.stopped = true
        this.save()
        throw e
      })
      const left = p ? await this.onMachineOf(t, () => this.wtOf(t).remove({ repo: p.path, wt: t.worktree!, branch: t.branch, label: labelOf(t) })) : []
      if (!p && t.worktree && (await exists(t.worktree))) left.push(`${t.worktree} (its project is gone)`)
      clearTimeout(this.later.get(t.id))
      for (const m of [this.later, this.wrote]) m.delete(t.id)
      // a Done task stays done for the ones queued after it
      if (ended(t)) this.passOn(t)
      this.data.tasks = this.data.tasks.filter((x) => x !== t)
      this.chats.forget(key)
      this.agents.forget(key)
      this.save()
      // a task queued after it waits on you now
      this.recheck()
      return left
    } finally {
      move(t, 'over')
    }
  }

  /* ---------- archiving ---------- */

  /**
   * Archive a task: it leaves every list and count, keeping its record, chat and summary (search and its place's
   * Archived view find it). A task whose agent runs is stopped first, as with task stop: its work stays.
   */
  async archive(id: string): Promise<{ kept: string[]; stopped: boolean }> {
    const t = this.req(id)
    if (t.archived) return { kept: [], stopped: false }
    t.archived = Date.now()
    t.pinned = undefined
    clearTimeout(this.later.get(t.id))
    this.quiet(t)
    const stopped = this.agents.status(this.key(t)) !== 'gone' && !ended(t)
    const kept = stopped ? await this.stopTask(t.id) : []
    // a finished task's agent may still be about: put away as merging would
    if (ended(t) && !t.cleaned && this.agents.status(this.key(t)) !== 'working') this.cleanup(t, true).catch(() => undefined)
    return { kept, stopped }
  }

  /** pin a task to the top of its lists (on) or unpin it; an archived one can't be pinned */
  pin(id: string, on: boolean) {
    const t = this.req(id)
    if (on && t.archived) throw new Error(`${t.id} is archived: unarchive it first (lineclear task unarchive ${t.id})`)
    if (!!t.pinned === on) return t
    t.pinned = on ? Date.now() : undefined
    this.save()
    return t
  }

  /** Ended tasks leave tasks.json RETIRE_AFTER after they ended, with their chats (retire.ts); never a pinned one or
   *  one whose agent you are talking to. Their agents' records go too, so agents-cold.jsonl does not grow for ever. */
  retireOld(now = Date.now()) {
    const gone = retireDue(this.data.tasks, (t) => ended(t) && !t.pinned && this.agents.status(this.key(t)) !== 'working', now)
    for (const t of gone) this.agents.forget(this.key(t))
    if (gone.length) this.save()
    return gone.length
  }

  /** Done tasks archive themselves once tasks.archiveAfter has passed since they finished (or were last brought back) */
  autoArchive(now = Date.now()) {
    // each after its own project's tasks.archiveAfter (off: never); never one whose agent you are talking to (it
    // works): its row would vanish mid-conversation
    const after = (t: TaskRec) => archiveAfterMs(this.settings.get('tasks.archiveAfter', this.nameOf(t)))
    const due = this.tasks.filter((t) => {
      const ms = after(t)
      return (
        ms !== null &&
        !t.archived &&
        this.statusOf(t) === 'done' &&
        this.agents.status(this.key(t)) !== 'working' &&
        now - Math.max(t.doneAt ?? t.updated, t.unarchived ?? 0) >= ms
      )
    })
    for (const t of due) {
      t.archived = now
      t.pinned = undefined
    }
    if (due.length) this.save()
    return due.length
  }

  /** A launch error is superseded only by verified private routing and a live owning agent.
   * Progress reports, queued messages and old hooks alone are not evidence of recovery. */
  routeRecovered(key: string) {
    const t = this.task(key.split('/')[0])
    if (!t || key !== this.key(t)) return

    const st = this.agents.status(key)
    if (t.trouble !== ROUTING_FAILURE || t.stopped || ended(t) || !this.agents.routed(key) || (st !== 'working' && st !== 'blocked')) return false
    t.trouble = undefined
    this.settle(t)
    this.save()
  }

  /** an agent's state changed in herdr */
  agentStatus(key: string) {
    const [id, role] = key.split('/')
    const t = this.task(id)
    if (!t || !role) return
    const st = this.agents.status(key)
    // a reviewer or attempt from before tasks had one agent only: put it away
    if (role !== 'Agent') {
      if (st !== 'gone' && !this.agents.record(key)?.finished) this.agents.finish(key).catch(() => undefined)
      return
    }
    if (ended(t)) {
      if (st !== 'working' && !t.cleaned) this.cleanup(t).catch(() => undefined)
      return
    }
    this.begun(t)
    // at work: the go reached it
    if (st === 'working' && t.going) t.going = undefined
    // paused, it stopped; at work again on its own after that, it isn't paused any more
    if (t.paused && st !== 'working') t.paused = 'idle'
    else if (t.paused === 'idle' && st === 'working') {
      t.paused = undefined
      t.todo = undefined
    }
    if (st === 'working' || st === 'blocked') {
      clearTimeout(this.later.get(t.id))
      this.settle(t)
    } else this.settleSoon(t)
  }

  /** automations: tasks of a project, by status (archived ones left out) */
  count(project: string, status: TaskStatus) {
    return this.tasks.filter((t) => t.project === project && !t.archived && this.statusOf(t) === status).length
  }
}
