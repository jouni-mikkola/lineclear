import { answersTo, renameLater, type TaskIds } from '../task-ids.ts'
import { trustWorktree } from '../trust.ts'
import { existsSync } from '../mfs.ts'
import { agentEnv, onMachine, type BoxInfo } from '../box.ts'
import type { Task, TaskStatus } from '../../../shared/types.ts'
import { Emitter } from '../../source.ts'
import { machineOf, recordWork } from '../../../../src/task-work.ts'
import { readJson, writeJson } from '../../store.ts'
import { ROOT } from '../../root.ts'
import { hidden, type Agents, type Spec } from '../agents.ts'
import type { Chats } from '../chats.ts'
import { HOST, type Places, type Space } from '../places.ts'
import { privatePrompt, taskFirst, taskPrompt } from '../prompts.ts'
import { pastTimes } from '../estimates.ts'
import type { Settings } from '../settings.ts'
import { Briefs, withoutBrief } from './briefs.ts'
import { COLD_AFTER, ColdLog, withCold } from './cold.ts'
import { AsyncLocalStorage } from 'node:async_hooks'
import { join } from 'node:path'
import { HeadWatch } from './lane-watch.ts'
import type { Worktrees, Made } from './worktrees.ts'
import {
  type TaskRec,
  type Harness,
  ended,
  type DepState,
  type PeerTask,
  splitRef,
  labelOf,
  MERGE_DEADLINE,
  type Events,
  BRIEF_WAIT,
} from './engine-helpers.ts'

export abstract class EngineState extends Emitter<Events> {
  constructor(
    protected agents: Agents,
    protected chats: Chats,
    protected places: Places,
    protected settings: Settings,
  ) {
    super()
  }

  /** main: by project path, the failing commit on GitHub's main its coordinator was told of, until main is green */
  private cold = new ColdLog<TaskRec>()
  private briefs = new Briefs()
  protected data = this.briefs.loaded(
    withCold(this.cold, readJson<{ next: Record<string, number>; tasks: TaskRec[]; red?: Record<string, string> }>('tasks.json', { next: {}, tasks: [] })),
  )
  taskIds!: TaskIds
  protected starting = new Set<string>()
  /** started, its brief not yet taken up: To do until its agent works on it */
  protected briefing = new Set<string>()
  protected wrote = new Map<string, number>()
  /** when its agent last reported its progress (lineclear status) */
  protected heard = new Map<string, number>()
  /** the last heartbeat of an agent in a tool call (lineclear alive): pi writes its log only when a call ends */
  protected beat = new Map<string, number>()
  protected later = new Map<string, ReturnType<typeof setTimeout>>()
  /** one merge at a time per repo: each one's main checkout is shared */
  protected merging = new Map<string, Promise<unknown>>()
  /** merges past the deadline: their caller may be gone, so an error not sent back yet goes to the chat */
  protected callerLeft = new Set<string>()
  /** merges the lane released while they ran: whatever they still do changes nothing */
  protected cut = new Set<number>()
  /** the run each lane head's merge has, so a released one is told from the task's next */
  protected runOf = new Map<string, number>()
  protected runs = 0
  protected inRun = new AsyncLocalStorage<number>()
  /** merges released in a row, per task: the second restarts its agent */
  protected released = new Map<string, number>()
  /** the way to end the merge of a task that holds its lane */
  protected frees = new Map<string, (r: { ok: false; error: string; freed: true }) => void>()
  protected headWatch = new HeadWatch()
  /** each task's merge while it runs */
  protected landings = new Map<string, Promise<{ ok: boolean; error?: string; note?: string }>>()
  /** how long a stopping Lineclear waits for the merges on their way, and after which a merge's caller may be gone
   *  (tests shorten it) */
  mergeDeadline = MERGE_DEADLINE
  /** stopping: no merge starts */
  protected closing = false
  /** how long GitHub's checks took lately, per repo, and when that was asked */
  protected took = new Map<string, { ms?: number; at: number }>()
  /** tasks whose place is being put away */
  protected cleaning = new Set<string>()
  protected sweeps: ReturnType<typeof setTimeout>[] = []
  protected wt!: Worktrees
  /** other machines' tasks, for a task queued after one (the main copy only: it is the one that sees them) */
  peerTask?: PeerTask
  /** its backup agent is taking over */
  protected handing = new Set<string>()
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

  /** the tasks at work, and those ended in the last COLD_AFTER, written whole; older ones only when they change */
  protected save() {
    const now = Date.now()
    this.briefs.write(this.data.tasks)
    const hot = this.cold.save(this.data.tasks, (t) => ended(t) && now - (t.doneAt ?? t.updated) >= COLD_AFTER, withoutBrief)
    writeJson('tasks.json', { ...this.data, tasks: hot.map(withoutBrief) })
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

  protected key(t: TaskRec) {
    return `${t.id}/Agent`
  }

  stop() {
    this.taskIds.close()
    for (const x of this.later.values()) clearTimeout(x)
    for (const x of this.sweeps) clearTimeout(x)
  }

  /* ---------- status: from the agent alone (status.ts) ---------- */

  abstract statusOf(t: TaskRec): TaskStatus
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

  /* ---------- queued after other tasks ---------- */

  /** it waits for other tasks (a stopped task waits for nothing until it is written to again) */
  protected queued(t: TaskRec) {
    return !!t.after?.length && !ended(t) && !t.stopped
  }

  /** how it ended, for a task queued after it: merged, or closed with nothing to merge, is done */
  outcomeOf(t: TaskRec): Task['outcome'] {
    if (ended(t)) return 'done'
    if (t.trouble) return 'failed'
    if (t.stopped) return 'stopped'
  }

  protected depState(ref: string): DepState {
    const [machine, id] = splitRef(ref)
    if (machine) {
      const x = this.peerTask?.(machine, id)
      if (x === 'away') return 'away'
      if (!x || x === 'unknown') return 'gone'
      return x.outcome ?? (x.status === 'done' ? 'done' : 'open')
    }
    const d = this.task(id)
    if (!d || (!ended(d) && !this.places.space(d.project))) return 'gone'
    return this.outcomeOf(d) ?? 'open'
  }

  /** the tasks it still waits for */
  protected open(t: TaskRec) {
    return (t.after ?? []).filter((ref) => this.depState(ref) !== 'done')
  }

  /** why it can't go on by itself: a task it waits for was stopped, went wrong or is gone */
  protected halts(t: TaskRec) {
    const why: Partial<Record<DepState, string>> = { stopped: 'was stopped', failed: 'went wrong', gone: 'is gone' }
    return (t.after ?? []).flatMap((ref) => {
      const w = why[this.depState(ref)]
      return w ? [`${ref} ${w}`] : []
    })
  }

  /** a queued task's line: what it still waits for ("After SHE-12, SHE-13"), and a machine that can't be reached */
  protected waitLine(t: TaskRec) {
    const open = this.open(t)
    const away = [...new Set(open.filter((ref) => this.depState(ref) === 'away').map((ref) => splitRef(ref)[0]))]
    return `After ${open.join(', ')}${away.length ? ` · can't reach ${away.join(', ')}` : ''}`
  }

  /** what each task it waited for said when it was done */
  protected notes(refs: string[]) {
    return refs.flatMap((ref) => {
      const [machine, id] = splitRef(ref)
      const x = machine ? this.peerTask?.(machine, id) : this.task(id)
      if (!x || typeof x === 'string') return []
      return x.said ? [`${ref} (${'title' in x ? x.title : x.name}): ${x.said}`] : []
    })
  }

  /* ---------- room on this machine ---------- */

  /** held until this machine has room (and nothing it waits for is still open) */
  protected holding(t: TaskRec) {
    return !!t.held && !ended(t) && !t.stopped && !this.queued(t)
  }

  /** a task at work, or on its way to it: those count against the machine's limit */
  protected busy(t: TaskRec) {
    if (ended(t) || t.archived || t.stopped || this.holding(t) || !this.places.space(t.project)) return false
    // a go sent just now counts before its agent is seen at work; one left from long ago (its agent gone) doesn't
    const going = !!t.going && Date.now() - (this.wrote.get(t.id) ?? 0) < BRIEF_WAIT
    return this.starting.has(t.id) || going || (this.briefing.has(t.id) && !t.todo) || this.statusOf(t) === 'work'
  }

  /** how many tasks are at work here now */
  working() {
    return this.tasks.filter((t) => this.busy(t)).length
  }

  /** how many tasks are at work on one machine now (none given: the server's own) */
  workingOn(machine?: string) {
    return this.tasks.filter((t) => (t.machine ?? undefined) === machine && this.busy(t)).length
  }

  /** whether one more task may start on a machine now (none given: the server's own), and if not, why: its slots are
   *  all taken, or the machine is too loaded. Every machine has the slots Settings gives (one store). */
  room(machine?: string): { why?: 'slots' | 'machine' } {
    const l = this.settings.machine()
    if (l.max !== null && this.workingOn(machine) >= l.max) return { why: 'slots' }
    const m = this.machine?.(machine)
    if (m && (m.busy || !m.herdr)) return { why: 'machine' }
    return {}
  }

  /**
   * Where a task may start now. One that has a place (a worktree, or named with --on) has only that machine. Any other
   * goes to the machine with the most free slots that has its space's repo and answers; the server's own on a tie.
   * No room anywhere: why the server's own (or the named machine) has none.
   */
  roomFor(t: TaskRec): { why?: 'slots' | 'machine'; machine?: string } {
    if (t.machine || t.worktree) return { ...this.room(t.machine), machine: t.machine }
    const own = this.room()
    const repo = this.places.space(t.project)?.machines ?? {}
    const max = this.settings.machine().max
    const free = (m?: string) => (max ?? Number.POSITIVE_INFINITY) - this.workingOn(m)
    let best: { machine?: string; free: number } | undefined = own.why ? undefined : { free: free() }
    for (const label of this.machines.keys()) {
      if (!repo[label] || !this.machine?.(label)?.herdr || this.room(label).why) continue
      if (!best || free(label) > best.free) best = { machine: label, free: free(label) }
    }
    return best ? { machine: best.machine } : { why: own.why }
  }

  /** tasks held now, oldest first */
  heldTasks() {
    return this.tasks.filter((t) => this.holding(t) && !t.archived).sort((a, b) => a.held!.since - b.held!.since)
  }

  /** hold it until there's room: its line says why, and its chat gets a small card */
  protected hold(t: TaskRec, why: 'slots' | 'machine', go?: { text: string; why: string; plain?: boolean }) {
    const l = this.settings.machine()
    t.held = { why, since: t.held?.since ?? Date.now(), ...(go ? { go: go.text, goWhy: go.why, plain: go.plain } : {}) }
    t.after = undefined
    t.todo = undefined
    const id = `held:${t.id}:${Date.now()}`
    const words = why === 'slots' ? `waiting for a free slot (${this.workingOn(t.machine)} of ${l.max} working)` : 'waiting for the machine: it is busy'
    this.chats.post(this.key(t), { id, card: { id, task: t.id, status: 'queued', text: words } })
    this.save()
    this.settleOne(t)
  }

  protected env(key: string) {
    return agentEnv(key, ROOT)
  }

  /**
   * Its agent, in its herdr space. A worktree that is gone (a stop with no work put it away, or it was lost) is made again first from its
   * branch, here or on origin, in the same folder, so its agent's session (kept by folder) is found again; a finished task's when its branch kept work.
   */
  protected launch(t: TaskRec, first?: string, made?: Made, as?: Harness, restart?: () => Promise<string | void>) {
    return this.onMachineOf(t, () => this.launchHere(t, first, made, as, restart))
  }

  private async launchHere(t: TaskRec, first?: string, made?: Made, as?: Harness, restart?: () => Promise<string | void>) {
    const key = this.key(t)
    const rec = this.agents.record(key)
    const p = this.proj(t)
    const home = { repo: p.path, name: p.name, install: p.install }
    if (!made && (!ended(t) || !!t.kept?.some((k) => k.startsWith('branch '))) && !existsSync(t.worktree!) && t.branch) {
      made = await this.wtOf(t).create(home, t.branch!, t.base!, labelOf(t), t.worktree)
      t.worktree = made.path
      this.save()
    }
    const env = this.env(key)
    // a task from before tasks kept their own CLI starts on Settings'
    const h = t.agent ?? this.settings.harness('task', this.nameOf(t))
    trustWorktree(t.worktree!, as?.kind ?? rec?.kind ?? h.kind, env)
    const spec: Spec = {
      access: 'full',
      key,
      name: rec?.name ?? `shep-${t.id.toLowerCase()}`,
      kind: as?.kind ?? rec?.kind ?? h.kind,
      // only its first start (or a backup's, on its CLI's own model): later, its own chat's pickers are what count
      ...(as ? { model: as.model ?? 'default', effort: as.effort } : rec ? {} : { model: h.model, effort: h.effort }),
      // what Settings said when it started on them: a change since is offered as a restart (restart.ts)
      ...(as || !rec ? { set: this.settings.harness('task', this.nameOf(t)) } : {}),
      cwd: t.worktree!,
      workspace: labelOf(t),
      tab: 'Agent',
      system:
        taskPrompt({ id: t.id, branch: t.branch!, base: t.base! }, pastTimes(this.data.tasks, t)) +
        '\n\n' +
        privatePrompt(this.settings.instructions('task', this.nameOf(t)), this.settings.instructions('reviewer', this.nameOf(t))),
      env,
      first,
      pane: () => this.wtOf(t).agentPane({ home, wt: t.worktree!, label: labelOf(t), tab: 'Agent', env, made }),
    }
    // a start, not a message to a running agent that launch only heals
    if (!rec || restart || this.agents.status(key) === 'gone') recordWork(t.id, 'agent', undefined, t.machine ?? machineOf())
    return restart ? this.agents.restart(spec, restart) : this.agents.ensure(spec)
  }

  /**
   * Its brief went in and its agent never began: it sits idle with no turn in its log (0% context). Its brief is sent
   * once more, with a line that says why, so it is never left to the human to find.
   */
  briefLate(t: TaskRec) {
    const key = this.key(t)
    const st = this.agents.status(key)
    if (t.briefResent || t.todo || t.stopped || ended(t) || (st !== 'idle' && st !== 'done') || this.agents.waiting(key).length) return
    if (this.chats.endedSince?.(key, this.agents.record(key)?.started ?? 0)) return
    t.briefResent = true
    this.save()
    const line = hidden(`${taskFirst(t)}\n\nYour brief is above and you have not started: begin your task now.`, 'go')
    this.agents.send(key, line, { ensure: () => this.launch(t) }).catch(() => undefined)
    this.emit('news', t.project, `${t.id}'s agent sat idle and never started on its brief. The brief was sent again`, 'stalled', {
      task: t.id,
      event: 'stalled',
    })
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
