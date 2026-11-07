import type { Engine } from './engine.ts'
import type { Task } from '../../../shared/types.ts'
import { placeId } from '../places.ts'
import { queuedLine, taskFirst } from '../prompts.ts'
import { settingsBlock } from '../settings-block.ts'
import { CLI_NAME } from '../settings.ts'
import * as GH from './github.ts'
import type { Made } from './worktrees.ts'
import { type TaskRec, type Harness, reportOf, ended, STATE, branchFor, troubleOf, short, LATER } from './engine-helpers.ts'
import { existsSync } from 'node:fs'
import { age, ago, clockWithDay } from '../../../shared/time.ts'
import { move } from './phase.ts'

const ORPHAN_AFTER = 2 * 60 * 60_000

export class EngineLaunch {
  constructor(private readonly e: Engine) {}

  /** settle one task, then the tasks queued after others: what it did may be what one of them waits for */
  settle(t: TaskRec) {
    this.e.settleOne(t)
    this.e.recheck()
    // what it did may free room for a held one
    this.e.release()
  }

  /* ---------- the view the screen draws ---------- */

  /** not done, its worktree gone and its agent dead for over ORPHAN_AFTER: nothing runs for it, so it holds no locks */
  orphaned(t: TaskRec, status: string): boolean {
    if (ended(t) || status === 'done' || !t.worktree || existsSync(t.worktree)) return false
    return Date.now() - t.updated > ORPHAN_AFTER && this.e.agents.status(this.e.key(t)) === 'gone'
  }

  view(t: TaskRec): Task {
    const status = this.e.statusOf(t)
    const key = this.e.key(t)
    const rec = this.e.agents.record(key)
    const cli = CLI_NAME[rec?.kind ?? t.agent?.kind ?? ''] ?? this.e.settings.get('task.agent', this.e.nameOf(t))
    const sub = this.e.subOf(t, status)
    const doneAt = status === 'done' ? (t.doneAt ?? t.updated) : undefined
    return {
      id: t.id,
      name: t.title,
      status,
      place: t.project,
      machine: t.machine,
      createdAt: t.created,
      aliases: t.aliases,
      sub,
      age: age(t.archived ?? doneAt ?? (status === 'todo' ? t.created : t.updated)),
      doneAt,
      branch: t.branch,
      base: t.base,
      mergeStopped: t.merged ? undefined : t.mergeStopped,
      pr: t.pr,
      plan: t.plan,
      agent:
        rec || t.worktree
          ? { chat: key, role: 'Agent', cli, status, age: age(rec?.started ?? t.updated), note: sub, herdr: this.e.agents.herdrView(key) }
          : undefined,
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
      after: this.e.startPart.queued(t) ? this.e.open(t) : undefined,
      outcome: this.e.outcomeOf(t),
      archived: t.archived,
      pinned: t.pinned,
      orphaned: this.orphaned(t, status) || undefined,
      // waiting out the provider, or a backup taking over: that line shows, not what its agent last reported
      report: this.e.inPhase(t, 'handing') ? undefined : reportOf(t.report, status),
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
    const p = this.e.places.byName(o.project) ?? this.e.places.byKey(o.project) ?? this.e.places.space(o.project)
    if (!p) throw new Error(`No project called ${o.project}`)
    // a new task is in no circle; those already done are not waited for
    const after = this.e.queuePart.checkAfter(undefined, o.after ?? []).filter((ref) => this.e.startPart.depState(ref) !== 'done')
    const title = short(o.title)
    const space = placeId.space(p.name)
    this.e.taskIds.ensure(space, p.key)
    let next = this.e.taskIds.allocate(space)
    while (this.e.foreignIds.has(next.id.toUpperCase())) next = this.e.taskIds.allocate(space)
    const { id, n, prefix } = next
    p.key = prefix
    this.e.data.next[prefix] = n
    // its project's defaults: its own, else its machine's, else All machines'
    const reviewer = this.harness(o.reviewer, 'reviewer', p.name)
    const agent = this.harness(o.agent, 'task', p.name)
    const set = o.set && Object.keys(o.set).length ? o.set : undefined
    // each line that differs from Lineclear's own says who set it: the coordinator's flags, or a level of Settings
    const by = {
      ...this.e.settings.setBy(p.name, set),
      ...(Object.keys(o.reviewer ?? {}).length ? { reviewer: 'task' as const } : {}),
      ...(Object.keys(o.agent ?? {}).length ? { agent: 'task' as const } : {}),
    }
    const ways = this.e.settings.ways(p.name, set)
    const how = settingsBlock(id, { ways, reviewer, agent, by })
    const desc = [o.desc ?? (title !== o.title ? o.title : ''), o.later ? LATER : '', how].filter(Boolean).join('\n\n')
    const t: TaskRec = {
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
      ...(ways.merge === 'ask me first' ? { askFirst: true } : {}),
    }
    if (after.length) t.after = after
    // one that starts work now waits for room; one for later only reads its brief, so it starts at once
    const room: { why?: 'slots' | 'machine'; machine?: string } = after.length || o.later ? {} : this.e.startPart.roomFor(t)
    if (!room.why && !after.length && !o.later) t.machine = room.machine
    this.e.data.tasks.push(t)
    if (room.why) {
      t.told = 'queued'
      this.e.startPart.hold(t, room.why)
    } else this.e.save()
    this.e.emit('news', t.project, `${t.id} was added: ${t.title}`, 'added', { task: t.id, event: 'added' })
    if (!room.why) this.startTask(t).catch((e) => this.troubled(t, e))
    return t
  }

  /** Settings' CLI, model and effort for tasks (or their reviewer), with what the coordinator chose for this one on
   *  top. Another CLI drops Settings' model, which names one of the first CLI's models; its effort goes in as the
   *  nearest level the other CLI takes (models.ts). */
  harness(chosen: Partial<Harness> = {}, role: 'task' | 'reviewer' = 'task', project?: string): Harness {
    const h = this.e.settings.harness(role, project)
    return { ...h, ...(chosen.kind && chosen.kind !== h.kind ? { model: undefined } : {}), ...chosen }
  }

  /** its agent waits for a go: To do until something is written to it (the go, or a change to the brief) */
  todo(id: string) {
    const t = this.e.req(id)
    if (ended(t)) throw new Error(`${t.id} is Done already (${t.closed ? 'nothing to merge' : 'merged'})`)
    t.todo = true
    // waiting for a go of its own: no longer just paused
    t.paused = undefined
    this.e.settle(t)
    return t
  }

  startTask(t: TaskRec) {
    return this.e.onMachineOf(t, () => this.startTaskHere(t))
  }

  private async startTaskHere(t: TaskRec) {
    if (!move(t, 'start')) throw new Error(`${t.id} is busy: try again in a moment`)
    t.trouble = t.stuck = undefined
    this.e.emit('changed')
    try {
      const p = this.e.proj(t)
      const branch = branchFor(t)
      // Old records without a snapshot keep the existing fallback; new tasks snapshot at add.
      t.base ??= p.base
      this.e.save()
      await GH.validateBase(p.path, t.base)
      let made: Made
      const began = Date.now()
      try {
        made = await this.e.wtOf(t).create({ repo: p.path, install: p.install }, branch, t.base)
      } catch (e) {
        const msg = (e as Error).message
        if (!/^Install failed/.test(msg)) throw new Error(`Could not make a worktree: ${msg}`)
        // its install step failed: a stall for its coordinator, not a question; its agent is not started on a worktree that cannot be checked
        t.stuck = msg.split('\n')[0].slice(0, 300)
        this.e.emit('card', t, 'work', `may be stuck: ${t.stuck}`)
        this.e.emit(
          'news',
          t.project,
          `${t.id} is stuck before its agent started: ${t.stuck}. Fix the install step (lineclear set space.install "<command>" --space ${p.name}) or the lockfile, then message the task to start it again`,
          'stalled',
          { task: t.id, event: 'stalled' },
        )
        this.e.save()
        return
      }
      Object.assign(t, { branch, worktree: made.path })
      this.e.save()
      const madeAt = Date.now()
      await this.e.launch(t, this.e.startPart.queued(t) ? `${taskFirst(t)}\n\n${queuedLine(this.e.open(t), 'start', t.id)}` : taskFirst(t), made)
      const install = made.installMs ?? 0
      t.startMs = { worktree: madeAt - began - install, install, session: Date.now() - madeAt }
      this.e.save()
      move(t, 'launched')
    } catch (e) {
      // went wrong before its worktree was there: it shows so
      t.trouble = troubleOf(e)
      throw e
    } finally {
      move(t, 'over')
      this.begun(t)
      this.e.settle(t)
    }
  }

  /** its agent works and its brief has gone in: it is at work on it, no longer To do */
  begun(t: TaskRec) {
    const key = this.e.key(t)
    if (!this.e.inPhase(t, 'briefing') || this.e.agents.status(key) !== 'working' || this.e.agents.waiting(key).length) return
    move(t, 'brief-over')
  }

  troubled(t: TaskRec, e: unknown) {
    this.e.answering.delete(t.id)
    t.trouble = troubleOf(e)
    this.e.settle(t)
  }
}
