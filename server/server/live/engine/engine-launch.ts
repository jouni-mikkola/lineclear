import type { Task } from '../../../shared/types.ts'
import { hidden } from '../agents.ts'
import { placeId } from '../places.ts'
import { goLine, settingsBlock, queuedLine, taskFirst } from '../prompts.ts'
import { CLI_NAME } from '../settings.ts'
import * as G from './git.ts'
import type { Made } from './worktrees.ts'
import {
  type TaskRec,
  type Harness,
  reportOf,
  ended,
  STATE,
  splitRef,
  START_GAP,
  branchFor,
  labelOf,
  troubleOf,
  short,
  ANSWER_GRACE,
  BRIEF_WAIT,
  LATER,
} from './engine-helpers.ts'
import { existsSync } from 'node:fs'
import { age, ago, clockWithDay } from '../../../shared/time.ts'
import { EngineStalls } from './stalls.ts'

const ORPHAN_AFTER = 2 * 60 * 60_000

export class EngineLaunch extends EngineStalls {
  /** settle one task, then the tasks queued after others: what it did may be what one of them waits for */
  protected settle(t: TaskRec) {
    this.settleOne(t)
    this.recheck()
    // what it did may free room for a held one
    this.release()
  }

  /** a turn that ends may be followed at once by the next: wait a moment before telling anyone it waits */
  protected settleSoon(t: TaskRec, ms = 4000) {
    clearTimeout(this.later.get(t.id))
    this.later.set(
      t.id,
      setTimeout(() => {
        this.later.delete(t.id)
        const t2 = this.task(t.id)
        if (t2) this.settle(t2)
      }, ms),
    )
  }

  /* ---------- the view the screen draws ---------- */

  /** not done, its worktree gone and its agent dead for over ORPHAN_AFTER: nothing runs for it, so it holds no locks */
  protected orphaned(t: TaskRec, status: string): boolean {
    if (ended(t) || status === 'done' || !t.worktree || existsSync(t.worktree)) return false
    return Date.now() - t.updated > ORPHAN_AFTER && this.agents.status(this.key(t)) === 'gone'
  }

  view(t: TaskRec): Task {
    const status = this.statusOf(t)
    const key = this.key(t)
    const rec = this.agents.record(key)
    const cli = CLI_NAME[rec?.kind ?? t.agent?.kind ?? ''] ?? this.settings.get('task.agent', this.nameOf(t))
    const sub = this.subOf(t, status)
    const doneAt = status === 'done' ? (t.doneAt ?? t.updated) : undefined
    return {
      id: t.id,
      name: t.title,
      status,
      place: t.project,
      machine: t.machine,
      sub,
      age: age(t.archived ?? doneAt ?? (status === 'todo' ? t.created : t.updated)),
      doneAt,
      branch: t.branch,
      base: t.base,
      mergeStopped: t.merged ? undefined : t.mergeStopped,
      pr: t.pr,
      plan: t.plan,
      agent: rec || t.worktree ? { chat: key, role: 'Agent', cli, status, age: age(rec?.started ?? t.updated), note: sub } : undefined,
      result: t.result,
      closed: t.closed || undefined,
      closedBy: t.closed ? t.closedBy : undefined,
      desc: t.desc || 'No brief yet.',
      said: t.said,
      facts: t.facts,
      state: t.archived
        ? `Archived · ${ago(t.archived)}`
        : status === 'todo'
          ? `To do · added ${ago(t.created)}`
          : t.closed
            ? `Done · nothing to merge · ${ago(doneAt ?? t.updated)}`
            : status === 'done'
              ? `Done · merged ${ago(doneAt ?? t.updated)}`
              : `${STATE[status]} · ${ago(doneAt ?? t.updated)}`,
      on: cli,
      created: `${clockWithDay(t.created)} by ${t.by}`,
      after: this.queued(t) ? this.open(t) : undefined,
      outcome: this.outcomeOf(t),
      archived: t.archived,
      pinned: t.pinned,
      orphaned: this.orphaned(t, status) || undefined,
      // waiting out the provider, or a backup taking over: that line shows, not what its agent last reported
      report: this.retrying(t) || this.handing.has(t.id) ? undefined : reportOf(t.report, status),
    }
  }

  /** a Done task is about to be deleted: those queued after it no longer wait for it, and the one that waited only
   *  for it is told to go (a deleted task is "gone", which would hold it for good) */
  protected passOn(t: TaskRec) {
    const notes = this.notes([t.id])
    for (const d of this.tasks.filter((d) => d !== t && this.queued(d) && d.after!.includes(t.id))) {
      const rest = d.after!.filter((ref) => ref !== t.id)
      d.after = rest.length ? rest : undefined
      if (!rest.length) this.goWhenRoom(d, goLine([t.id], notes), `${t.id} is done`)
    }
  }

  /**
   * Queued tasks: each whose tasks are all done is told to go; the rest show what they wait for, or that one of them
   * ended without being done (then it waits for you).
   */
  recheck() {
    if (this.checking) return
    this.checking = true
    try {
      for (const t of this.tasks.filter((t) => this.queued(t))) {
        if (!this.open(t).length)
          this.goWhenRoom(t, goLine(t.after!, this.notes(t.after!)), `${t.after!.join(', ')} ${t.after!.length === 1 ? 'is' : 'are'} done`)
        else if (this.statusOf(t) !== t.told) this.settleOne(t)
      }
    } finally {
      this.checking = false
    }
  }

  /**
   * After a start: a go that never reached its agent (a restart cut it off) is sent again; then the queue is checked.
   */
  resumeQueue() {
    for (const t of this.tasks.filter((t) => t.going && !ended(t) && !t.stopped && this.agents.status(this.key(t)) !== 'working'))
      this.agents.send(this.key(t), hidden(t.going!, 'go'), { ensure: () => this.launch(t) }).catch(() => undefined)
    this.recheck()
  }

  /** the go: its agent hears it (hidden from the chat, where a small card says why it started) and starts on the work */
  protected go(t: TaskRec, text: string, why: string, plain = false) {
    // archived while it waited: it starts work, so it shows again
    if (t.archived) this.unarchive(t.id)
    t.after = undefined
    t.held = undefined
    t.todo = undefined
    t.reported = false
    this.briefing.delete(t.id)
    // a coordinator's own words go in as they are, and are not sent again after a restart
    t.going = plain ? undefined : text
    this.wrote.set(t.id, Date.now())
    const key = this.key(t)
    const id = `go:${t.id}:${Date.now()}`
    this.chats.post(key, { id, card: { id, task: t.id, status: 'work', text: `started: ${why}` } })
    this.save()
    this.agents.send(key, plain ? text : hidden(text, 'go'), { ensure: () => this.launch(t) }).catch(() => undefined)
    this.settleOne(t)
    this.settleSoon(t, ANSWER_GRACE + 500)
  }

  /**
   * What a task waits for, as written ("SHE-12", "she-12", "vm-str:SHE-12"), checked: each one there, never itself, and
   * no circle (SHE-3 waits for SHE-5, which waits for SHE-3). Kept by their ids as shown.
   */
  checkAfter(self: string | undefined, refs: string[]): string[] {
    const out: string[] = []
    for (const raw of refs.flatMap((r) => r.split(/[\s,]+/)).filter(Boolean)) {
      const [machine, id] = splitRef(raw)
      let ref: string
      if (machine) {
        if (!this.peerTask) throw new Error(`${raw}: only the main machine sees other machines' tasks, so only its tasks can wait for them`)
        const x = this.peerTask(machine, id)
        if (x === 'unknown') throw new Error(`${raw}: no machine called ${machine}`)
        if (x === 'away') throw new Error(`${raw}: can't reach ${machine} right now, so it can't be checked; try again later`)
        if (!x) throw new Error(`${raw}: ${machine} has no task ${id}`)
        ref = `${machine}:${x.id}`
      } else {
        const d = this.task(id)
        if (!d) throw new Error(`No task ${id}`)
        if (self && d.id.toUpperCase() === self.toUpperCase()) throw new Error(`${d.id} can't wait for itself`)
        ref = d.id
      }
      if (!out.includes(ref)) out.push(ref)
    }
    if (self)
      for (const ref of out) {
        const loop = this.circle(self, ref, [self])
        if (loop) throw new Error(`That would wait in a circle: ${loop.join(' → ')}`)
      }
    return out
  }

  /** the path back to `self` through what `ref` waits for in turn, if there is one */
  protected circle(self: string, ref: string, path: string[]): string[] | undefined {
    if (splitRef(ref)[0]) return undefined
    const d = this.task(ref)
    if (!d) return undefined
    if (d.id.toUpperCase() === self.toUpperCase()) return [...path, d.id]
    if (path.includes(d.id)) return undefined
    for (const next of this.queued(d) ? d.after! : []) {
      const loop = this.circle(self, next, [...path, d.id])
      if (loop) return loop
    }
  }

  /**
   * Queue a task after others, change what it waits for, or (none) clear it. Its agent is told: to hold on (it may be
   * at work), what it waits for now, or to go. `self`: its own agent asked, and needs no message for it.
   */
  queue(id: string, refs: string[], opts: { self?: boolean } = {}): { queued: string[]; went?: boolean } {
    const t = this.req(id)
    if (ended(t)) throw new Error(`${t.id} is Done already (${t.closed ? 'nothing to merge' : 'merged'})`)
    const after = this.checkAfter(t.id, refs)
    const was = this.queued(t) ? t.after! : []
    const open = after.filter((ref) => this.depState(ref) !== 'done')
    if (!open.length) {
      if (!was.length) return { queued: [] }
      if (after.length) this.goWhenRoom(t, goLine(after, this.notes(after)), `${after.join(', ')} ${after.length === 1 ? 'is' : 'are'} done`)
      else this.goWhenRoom(t, goLine(was, [], true), `no longer waits for ${was.join(', ')}`)
      return { queued: [], went: true }
    }
    t.after = after
    t.stopped = undefined
    clearTimeout(this.later.get(t.id))
    const key = this.key(t)
    const cid = `queued:${t.id}:${Date.now()}`
    this.chats.post(key, { id: cid, card: { id: cid, task: t.id, status: 'queued', text: `queued after ${open.join(', ')}` } })
    this.save()
    if (!opts.self && this.agents.status(key) !== 'gone')
      this.agents.send(key, hidden(queuedLine(open, was.length ? 'changed' : 'later', t.id), 'queue'), { ensure: () => this.launch(t) }).catch(() => undefined)
    this.settleOne(t)
    return { queued: open }
  }

  /** the go, now if this machine has room, else once it has */
  protected goWhenRoom(t: TaskRec, text: string, why: string, plain = false) {
    const r = this.room()
    if (r.why) return this.hold(t, r.why, { text, why, plain })
    this.go(t, text, why, plain)
  }

  /**
   * Start held tasks while this machine has room, oldest first. While load decides, one at a time, START_GAP apart:
   * the load average takes a moment to show what a task adds. Called on each health sample and status change.
   */
  release(now = Date.now()) {
    if (this.releasing) return
    this.releasing = true
    try {
      const byLoad = this.settings.machine().startLoad !== null
      for (const t of this.heldTasks()) {
        const r = this.room()
        if (r.why) {
          // each one waits for the same reason: its line says the one that holds them now
          const stale = this.heldTasks().filter((x) => x.held!.why !== r.why)
          for (const x of stale) x.held!.why = r.why
          if (stale.length) this.save()
          return
        }
        if (byLoad && now - this.lastStart < START_GAP) return
        this.lastStart = now
        const why = t.held!.why === 'slots' ? 'a slot is free' : 'the machine has room'
        if (t.held!.go) this.go(t, t.held!.go, `${t.held!.goWhy ?? why} · ${why}`, t.held!.plain)
        else {
          t.held = undefined
          const id = `go:${t.id}:${now}`
          this.chats.post(this.key(t), { id, card: { id, task: t.id, status: 'work', text: `started: ${why}` } })
          this.save()
          this.startTask(t).catch((e) => this.troubled(t, e))
        }
      }
    } finally {
      this.releasing = false
    }
  }

  /* ---------- adding and starting ---------- */

  /**
   * A new task: its agent starts on the brief at once. The brief ends with the default way of working from Settings;
   * its CLI, model and effort are Settings' too, unless the coordinator chose others for it.
   */
  add(o: {
    project: string
    base?: string
    title: string
    result?: string
    desc?: string
    by: string
    requester?: string
    after?: string[]
    later?: boolean
    agent?: Partial<Harness>
    reviewer?: Partial<Harness>
    set?: Record<string, string>
    machine?: string
  }) {
    const p = this.places.byName(o.project) ?? this.places.byKey(o.project) ?? this.places.space(o.project)
    if (!p) throw new Error(`No project called ${o.project}`)
    // a new task is in no circle; those already done are not waited for
    const after = this.checkAfter(undefined, o.after ?? []).filter((ref) => this.depState(ref) !== 'done')
    const title = short(o.title)
    const space = placeId.space(p.name)
    this.taskIds.ensure(space, p.key)
    const { id, n, prefix } = this.taskIds.allocate(space)
    p.key = prefix
    this.data.next[prefix] = n
    // its project's defaults: its own, else its machine's, else All machines'
    const reviewer = this.harness(o.reviewer, 'reviewer', p.name)
    const agent = this.harness(o.agent, 'task', p.name)
    const set = o.set && Object.keys(o.set).length ? o.set : undefined
    // each line that differs from Shepherdr's own says who set it: the coordinator's flags, or a level of Settings
    const by = {
      ...this.settings.setBy(p.name, set),
      ...(Object.keys(o.reviewer ?? {}).length ? { reviewer: 'task' as const } : {}),
      ...(Object.keys(o.agent ?? {}).length ? { agent: 'task' as const } : {}),
    }
    const ways = this.settings.ways(p.name, set)
    const how = settingsBlock(id, { ways, reviewer, agent, by })
    const desc = [o.desc ?? (title !== o.title ? o.title : ''), o.later ? LATER : '', how].filter(Boolean).join('\n\n')
    const t: TaskRec = {
      pilot: this.pilotOwner?.(o.requester),
      id,
      n,
      project: placeId.space(p.name),
      machine: o.machine,
      base: o.base ?? p.base,
      title,
      result: o.result,
      desc,
      by: o.by,
      requester: o.requester,
      created: Date.now(),
      updated: Date.now(),
      told: after.length ? 'queued' : 'work',
      agent,
      reviewer,
      waitChecks: ways.waitChecks,
    }
    if (after.length) t.after = after
    // one that starts work now waits for room; one for later only reads its brief, so it starts at once
    const room = after.length || o.later ? {} : this.room()
    this.data.tasks.push(t)
    if (t.pilot) this.pilotClaim?.(t)
    if (room.why) {
      t.told = 'queued'
      this.hold(t, room.why)
    } else this.save()
    this.emit('news', t.project, `${t.id} was added: ${t.title}`, 'added', { task: t.id, event: 'added' })
    if (!room.why) this.startTask(t).catch((e) => this.troubled(t, e))
    return t
  }

  /** Settings' CLI, model and effort for tasks (or their reviewer), with what the coordinator chose for this one on
   *  top. Another CLI drops Settings' model, which names one of the first CLI's models; its effort goes in as the
   *  nearest level the other CLI takes (models.ts). */
  protected harness(chosen: Partial<Harness> = {}, role: 'task' | 'reviewer' = 'task', project?: string): Harness {
    const h = this.settings.harness(role, project)
    return { ...h, ...(chosen.kind && chosen.kind !== h.kind ? { model: undefined } : {}), ...chosen }
  }

  /** its agent waits for a go: To do until something is written to it (the go, or a change to the brief) */
  todo(id: string) {
    const t = this.req(id)
    if (ended(t)) throw new Error(`${t.id} is Done already (${t.closed ? 'nothing to merge' : 'merged'})`)
    t.todo = true
    // waiting for a go of its own: no longer just paused
    t.paused = undefined
    clearTimeout(this.later.get(t.id))
    this.settle(t)
    return t
  }

  protected startTask(t: TaskRec) {
    return this.onMachineOf(t, () => this.startTaskHere(t))
  }

  private async startTaskHere(t: TaskRec) {
    this.pilotGate?.(t)
    this.starting.add(t.id)
    t.trouble = t.stuck = undefined
    this.emit('changed')
    try {
      const p = this.proj(t)
      const branch = branchFor(t)
      // Old records without a snapshot keep the existing fallback; new tasks snapshot at add.
      t.base ??= p.base
      this.save()
      await G.validateBase(p.path, t.base)
      let made: Made
      try {
        made = await this.wtOf(t).create({ repo: p.path, name: p.name, install: p.install }, branch, t.base, labelOf(t))
      } catch (e) {
        const msg = (e as Error).message
        if (!/^Install failed/.test(msg)) throw new Error(`Could not make a worktree: ${msg}`)
        // its install step failed: a stall for its coordinator, not a question; its agent is not started on a worktree that cannot be checked
        t.stuck = msg.split('\n')[0].slice(0, 300)
        this.emit('card', t, 'work', `may be stuck: ${t.stuck}`)
        this.emit(
          'news',
          t.project,
          `${t.id} is stuck before its agent started: ${t.stuck}. Fix the install step (lineclear set space.install "<command>" --space ${p.name}) or the lockfile, then message the task to start it again`,
          'stalled',
          { task: t.id, event: 'stalled' },
        )
        this.save()
        return
      }
      Object.assign(t, { branch, worktree: made.path })
      this.save()
      await this.launch(t, this.queued(t) ? `${taskFirst(t)}\n\n${queuedLine(this.open(t), 'start', t.id)}` : taskFirst(t), made)
      this.briefing.add(t.id)
      clearTimeout(this.later.get(`${t.id}:brief`))
      const x = setTimeout(() => {
        this.later.delete(`${t.id}:brief`)
        if (this.briefing.delete(t.id)) {
          this.briefLate(t)
          this.settle(t)
        }
      }, BRIEF_WAIT)
      x.unref?.()
      this.later.set(`${t.id}:brief`, x)
    } catch (e) {
      // went wrong before its worktree was there: it shows so
      t.trouble = troubleOf(e)
      throw e
    } finally {
      this.starting.delete(t.id)
      this.begun(t)
      this.settle(t)
    }
  }

  /** its agent works and its brief has gone in: it is at work on it, no longer To do */
  protected begun(t: TaskRec) {
    const key = this.key(t)
    if (!this.briefing.has(t.id) || this.agents.status(key) !== 'working' || this.agents.waiting(key).length) return
    this.briefing.delete(t.id)
    clearTimeout(this.later.get(`${t.id}:brief`))
    this.later.delete(`${t.id}:brief`)
  }

  protected troubled(t: TaskRec, e: unknown) {
    t.trouble = troubleOf(e)
    this.settle(t)
  }
}
