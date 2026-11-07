import { answersTo, renameLater, type TaskIds } from '../task-ids.ts'
import { onMachine, type BoxInfo } from '../box.ts'
import type { TaskStatus } from '../../../shared/types.ts'
import { Emitter } from '../../source.ts'
import type { Agents } from '../agents.ts'
import type { Chats } from '../chats.ts'
import { HOST, type Places, type Space } from '../places.ts'
import type { Settings } from '../settings.ts'
import { TaskRows } from './task-rows.ts'
import { join } from 'node:path'
import type { Worktrees } from './worktrees.ts'
import { type Phase, move } from './phase.ts'
import { type TaskRec, ended, type PeerTask, splitRef, MERGE_DEADLINE, type Events } from './engine-helpers.ts'

export abstract class EngineState extends Emitter<Events> {
  constructor(
    protected agents: Agents,
    protected chats: Chats,
    protected places: Places,
    protected settings: Settings,
  ) {
    super()
  }

  protected store = new TaskRows<TaskRec>()
  protected data = this.store.load()
  taskIds!: TaskIds
  protected wrote = new Map<string, number>()
  /** tasks written to whose agent has not yet said agent_start or agent_settled: they read as work until it does */
  protected answering = new Set<string>()
  /** when its agent last reported its progress (lineclear status) */
  protected heard = new Map<string, number>()
  /** the last heartbeat of an agent in a tool call (lineclear alive): pi writes its log only when a call ends */
  protected beat = new Map<string, number>()
  protected later = new Map<string, ReturnType<typeof setTimeout>>()
  /** one merge at a time per repo: each one's main checkout is shared */
  protected merging = new Map<string, Promise<unknown>>()
  /** merges past the deadline: their caller may be gone, so an error not sent back yet goes to the chat */
  protected callerLeft = new Set<string>()
  /** merges released in a row, per task: the second restarts its agent */
  protected released = new Map<string, number>()
  /** the way to end the merge of a task that holds its lane */
  protected frees = new Map<string, (r: { ok: false; error: string; freed: true }) => void>()
  /** per repo, the commit its main is red at in the required check, kept by the main watch */
  protected heldRed = new Map<string, string>()
  /** how long a merge may hold its repo's line before the lane releases it; none: the project's turn limit (tests shorten it) */
  headLimitMs?: number
  /** each task's merge while it runs */
  protected landings = new Map<string, Promise<{ ok: boolean; error?: string; note?: string }>>()
  /** how long a stopping Lineclear waits for the merges on their way, and after which a merge's caller may be gone
   *  (tests shorten it) */
  mergeDeadline = MERGE_DEADLINE
  /** stopping: no merge starts */
  protected closing = false
  /** how long GitHub's checks took lately, per repo, and when that was asked */
  protected took = new Map<string, { ms?: number; at: number }>()
  protected wt!: Worktrees
  /** other machines' tasks, for a task queued after one (the main copy only: it is the one that sees them) */
  peerTask?: PeerTask
  /** a CLI is installed here (a test says) */
  installed = (kind: string) => !!Bun.which(kind)
  /** how loaded this machine is now: over a start limit (health.ts busy), and whether herdr answers; none until first
   *  measured, which holds nothing by load */
  machine?: (machine?: string) => { busy?: 'cpu' | 'memory'; herdr: boolean } | undefined
  /** when a held task last started while load decided */
  protected lastStart = 0
  protected releasing = false
  protected checking = false
  /** the look at done tasks' pull requests that is under way */
  protected watching: Promise<void> | undefined
  protected watchingMain = false

  get tasks() {
    return this.data.tasks
  }

  /** ids other machines hold, so a new id skips them */
  protected foreignIds = new Set<string>()

  /** by id or alias; "this-machine:ID" names this machine's own task */
  task(id: string) {
    const find = (ref: string) => this.data.tasks.find((t) => answersTo(t, ref))
    const [machine, bare] = splitRef(id)
    return find(id) ?? (machine || bare === id ? undefined : find(bare))
  }

  /** after another machine's tasks showed: renames this machine's tasks that share an id with an earlier one there */
  unifyIds(others: { machine: string; tasks: { id: string; createdAt?: number; aliases?: string[] }[] }[]) {
    const seen = others.map((o) => ({
      machine: o.machine,
      tasks: o.tasks.map((t) => ({ id: t.id, created: t.createdAt ?? Number.POSITIVE_INFINITY, aliases: t.aliases })),
    }))
    this.foreignIds = new Set(others.flatMap((o) => o.tasks.map((t) => t.id.toUpperCase())))
    // a task at work keeps its id: its chat, branch and brief are keyed by it, and it is renamed once it ends
    const renamed = renameLater(this.taskIds, HOST, this.data.tasks, seen, (t) => !(t as TaskRec).worktree || ended(t as TaskRec))
    if (!renamed.length) return
    for (const t of this.data.tasks) t.after = t.after?.map((a) => renamed.find((r) => r.from.toUpperCase() === a.toUpperCase())?.to ?? a)
    this.save()
  }

  /** writes the rows of the tasks that changed */
  protected save() {
    this.store.save(this.data)
    this.emit('changed')
  }

  /** the machines tasks run on besides the server's own, by label */
  readonly machines = new Map<string, BoxInfo>()
  /** a machine's own worktree keeper, when its herdr is not the one the server's is reached through (tests) */
  protected readonly machineWt = new Map<string, Worktrees>()

  /** names a machine tasks may run on; `wt` is its herdr's worktree keeper when it differs from the server's */
  addMachine(box: BoxInfo, wt?: Worktrees) {
    this.machines.set(box.label, box)
    if (wt) this.machineWt.set(box.label, wt)
  }

  /** makes these the machines tasks may run on, those saved in herdr: a machine herdr no longer has is dropped, one
   *  with a herdr socket of its own (tests) stays */
  setMachines(boxes: BoxInfo[]) {
    for (const [label, box] of this.machines) if (!box.socket && !boxes.some((b) => b.label === label)) this.machines.delete(label)
    for (const box of boxes) if (!this.machines.get(box.label)?.socket) this.machines.set(box.label, box)
  }

  /** the worktree keeper for the task's machine */
  protected wtOf(t: Pick<TaskRec, 'machine'>): Worktrees {
    return (t.machine && this.machineWt.get(t.machine)) || this.wt
  }

  /** runs `fn` for the task's machine: its commands, files and herdr calls go there, as on the server's own */
  protected onMachineOf<T>(t: Pick<TaskRec, 'machine'>, fn: () => T): T {
    const box = t.machine ? this.machines.get(t.machine) : undefined
    return t.machine ? onMachine(box ?? null, fn) : fn()
  }

  /** the task's project, its folder as that machine has it (`~/` is that machine's home) */
  protected proj(t: TaskRec): Space {
    const p = this.places.space(t.project)
    if (!p) throw new Error(`${t.id}: its project is gone`)
    if (!t.machine) return p
    const at = p.machines?.[t.machine] ?? p.path
    const home = this.machines.get(t.machine)?.home
    return { ...p, path: home && at.startsWith('~/') ? join(home, at.slice(2)) : at }
  }

  protected inPhase(t: TaskRec, phase: Phase) {
    return (t.phase ?? 'idle') === phase
  }

  /** once the engine is up: a start, a handoff or a clean-up it was in the middle of is gone, so its phase is too.
   *  A brief phase stays: its agent may still take the brief up, and resumeQueue arms its timer again */
  protected endPhases() {
    for (const t of this.tasks) if (!this.inPhase(t, 'briefing')) move(t, 'interrupted')
  }

  protected key(t: TaskRec) {
    return `${t.id}/Agent`
  }

  stop() {
    this.taskIds.close()
    for (const x of this.later.values()) clearTimeout(x)
  }

  /* ---------- status: from the agent alone (status.ts) ---------- */

  abstract statusOf(t: TaskRec): TaskStatus
  /** lets go of a merge that held its line past its limit (engine-tidy) */
  declare protected releaseHead: (t: TaskRec, ctl: AbortController, limitMs: number) => Promise<void>
  abstract subOf(t: TaskRec, status?: TaskStatus): string

  /** a task's agent may be written to: not stopped, paused, waiting for a go, archived or
   *  finished since */
  mayRetry(key: string) {
    const t = this.task(key.split('/')[0])
    return !!t && key === this.key(t) && !t.stopped && !t.todo && !t.archived && !ended(t)
  }

  /** it asks you something: a choice card or the CLI's own question still open (facts, never a guess from its words) */
  protected asks(key: string) {
    return !!(this.chats.openCard(key) || this.chats.openQuestion(key))
  }

  /** tell coordinators and the screen when the status changed; a card when it now waits on you or is done */
  protected settleOne(t: TaskRec) {
    const status = this.statusOf(t)
    this.pace(t, status)
    if (status === t.told) return this.emit('changed')
    // archived: put away quietly, no card, news or alert
    if (t.archived) return this.quiet(t, status)
    const before = t.told
    t.told = status
    const sub = this.subOf(t, status)
    // a task from before this was told: what it shows now is where it starts, not news
    if (before === undefined) {
      t.posted = `${status}|${sub}`
      return this.save()
    }
    t.updated = Date.now()
    // back at work: the next time it waits is news again, even with the same words
    if (status === 'work') t.posted = undefined
    if (status === 'need' || status === 'ready') {
      const key = `${status}|${sub}`
      if (t.posted !== key) {
        t.posted = key
        this.emit('card', t, status, sub)
        this.emit(
          'news',
          t.project,
          `${t.id} ${status === 'ready' ? `is ready to merge${t.said ? `: ${t.said}` : ''}${t.facts ? ` (Facts: ${t.facts})` : ''}` : `needs you: ${sub}`}`,
          status === 'ready' ? 'ready' : 'need',
          { task: t.id, event: status === 'ready' ? 'ready' : 'needs-you' },
        )
      }
    }
    if (status === 'done' && before !== 'done') {
      t.posted = `done|${sub}`
      this.emit('card', t, status, sub)
      this.emit('news', t.project, `${t.id} ${t.closed ? `is done, nothing to merge${t.said ? `: ${t.said}` : ''}` : 'was merged'}`, 'done', {
        task: t.id,
        event: t.closed ? 'closed' : 'merged',
      })
    }
    this.save()
  }

  /** its report follows its status: its clock stops while it waits on you, and the report goes once its job is over */
  protected pace(t: TaskRec, status: TaskStatus) {
    const r = t.report
    if (!r) return
    if (status === 'need') r.pausedAt ??= Date.now()
    else if (status !== 'work') t.report = undefined
    else if (r.pausedAt) {
      r.at += Date.now() - r.pausedAt
      r.pausedAt = undefined
    }
  }

  /** what it shows now is taken as told and posted: nothing about it is news */
  protected quiet(t: TaskRec, status = this.statusOf(t)) {
    t.told = status
    t.posted = `${status}|${this.subOf(t, status)}`
    this.save()
  }

  protected req(id: string) {
    const t = this.task(id)
    if (!t) throw new Error(`No task ${id}`)
    return t
  }

  /** bring an archived task back into its lists, as it is now: nothing about it is news */
  unarchive(id: string) {
    const t = this.req(id)
    if (!t.archived) return t
    t.archived = undefined
    t.unarchived = Date.now()
    this.quiet(t)
    return t
  }

  /** a task's project's name, for its defaults */
  protected nameOf(t: TaskRec) {
    return this.places.space(t.project)?.name
  }
}
