import type { Engine } from './engine.ts'
import { chooseModel, firstModel } from '../../../../src/models.ts'
import { exists } from '../mfs.ts'
import { agentEnv } from '../box.ts'
import type { Task } from '../../../shared/types.ts'
import { machineOf, recordWork } from '../../../../src/task-work.ts'
import { ROOT } from '../../root.ts'
import type { Spec } from '../agents.ts'
import { privatePrompt, taskPrompt } from '../prompts.ts'
import { pastTimes } from '../estimates.ts'
import type { Made } from './worktrees.ts'
import { type TaskRec, type Harness, ended, type DepState, splitRef, labelOf } from './engine-helpers.ts'

/** what a task needs before its agent runs: the tasks it waits for, room on the machine, and the agent's start */
export class EngineStart {
  constructor(private readonly e: Engine) {}

  /** it waits for other tasks (a stopped task waits for nothing until it is written to again) */
  queued(t: TaskRec) {
    return !!t.after?.length && !ended(t) && !t.stopped
  }

  /** how it ended, for a task queued after it: merged, or closed with nothing to merge, is done */
  outcomeOf(t: TaskRec): Task['outcome'] {
    if (ended(t)) return 'done'
    if (t.trouble) return 'failed'
    if (t.stopped) return 'stopped'
  }

  depState(ref: string): DepState {
    const [machine, id] = splitRef(ref)
    if (machine) {
      const x = this.e.peerTask?.(machine, id)
      if (x === 'away') return 'away'
      if (!x || x === 'unknown') return 'gone'
      return x.outcome ?? (x.status === 'done' ? 'done' : 'open')
    }
    const d = this.e.task(id)
    if (!d || (!ended(d) && !this.e.places.space(d.project))) return 'gone'
    return this.e.outcomeOf(d) ?? 'open'
  }

  /** the tasks it still waits for */
  open(t: TaskRec) {
    return (t.after ?? []).filter((ref) => this.depState(ref) !== 'done')
  }

  /** why it can't go on by itself: a task it waits for was stopped, went wrong or is gone */
  halts(t: TaskRec) {
    const why: Partial<Record<DepState, string>> = { stopped: 'was stopped', failed: 'went wrong', gone: 'is gone' }
    return (t.after ?? []).flatMap((ref) => {
      const w = why[this.depState(ref)]
      return w ? [`${ref} ${w}`] : []
    })
  }

  /** a queued task's line: what it still waits for ("After SHE-12, SHE-13"), and a machine that can't be reached */
  waitLine(t: TaskRec) {
    const open = this.e.open(t)
    const away = [...new Set(open.filter((ref) => this.depState(ref) === 'away').map((ref) => splitRef(ref)[0]))]
    return `After ${open.join(', ')}${away.length ? ` · can't reach ${away.join(', ')}` : ''}`
  }

  /** what each task it waited for said when it was done */
  notes(refs: string[]) {
    return refs.flatMap((ref) => {
      const [machine, id] = splitRef(ref)
      const x = machine ? this.e.peerTask?.(machine, id) : this.e.task(id)
      if (!x || typeof x === 'string') return []
      return x.said ? [`${ref} (${'title' in x ? x.title : x.name}): ${x.said}`] : []
    })
  }

  /* ---------- room on this machine ---------- */

  /** held until this machine has room (and nothing it waits for is still open) */
  holding(t: TaskRec) {
    return !!t.held && !ended(t) && !t.stopped && !this.queued(t)
  }

  /** a task at work, or on its way to it: those count against the machine's limit */
  busy(t: TaskRec) {
    if (ended(t) || t.archived || t.stopped || this.holding(t) || !this.e.places.space(t.project)) return false
    // a go sent just now counts before its agent is seen at work; one left from long ago (its agent gone) doesn't
    const going = !!t.going && this.e.agents.status(this.e.key(t)) !== 'gone'
    if (this.e.inPhase(t, 'starting') || going || (this.e.inPhase(t, 'briefing') && !t.todo)) return true
    // the status last settled, while its agent agrees: the full status of every task for each held one was what made this slow
    const working = this.e.agents.status(this.e.key(t)) === 'working'
    if (t.told !== undefined && (t.told === 'work') === working) return working
    return this.e.statusOf(t) === 'work'
  }

  /** how many tasks are at work here now */
  working() {
    return this.e.tasks.filter((t) => this.busy(t)).length
  }

  /** how many tasks are at work on one machine now (none given: the server's own) */
  workingOn(machine?: string) {
    return this.e.tasks.filter((t) => (t.machine ?? undefined) === machine && this.busy(t)).length
  }

  /** whether one more task may start on a machine now (none given: the server's own), and if not, why: its slots are
   *  all taken, or the machine is too loaded. Every machine has the slots Settings gives (one store). */
  room(machine?: string): { why?: 'slots' | 'machine' } {
    const l = this.e.settings.machine()
    if (l.max !== null && this.e.workingOn(machine) >= l.max) return { why: 'slots' }
    const m = this.e.machine?.(machine)
    if (m && (m.busy || !m.herdr)) return { why: 'machine' }
    return {}
  }

  /**
   * Where a task may start now. One that has a place (a worktree, or named with --on) has only that machine. Any other
   * goes to the machine with the most free slots that has its space's repo and answers; the server's own on a tie.
   * No room anywhere: why the server's own (or the named machine) has none.
   */
  roomFor(t: TaskRec): { why?: 'slots' | 'machine'; machine?: string } {
    if (t.machine || t.worktree) return { ...this.e.room(t.machine), machine: t.machine }
    const own = this.e.room()
    const repo = this.e.places.space(t.project)?.machines ?? {}
    const max = this.e.settings.machine().max
    const free = (m?: string) => (max ?? Number.POSITIVE_INFINITY) - this.e.workingOn(m)
    let best: { machine?: string; free: number } | undefined = own.why ? undefined : { free: free() }
    for (const label of this.e.machines.keys()) {
      if (!repo[label] || !this.e.machine?.(label)?.herdr || this.e.room(label).why) continue
      if (!best || free(label) > best.free) best = { machine: label, free: free(label) }
    }
    return best ? { machine: best.machine } : { why: own.why }
  }

  /** tasks held now, oldest first */
  heldTasks() {
    return this.e.tasks.filter((t) => this.holding(t) && !t.archived).sort((a, b) => a.held!.since - b.held!.since)
  }

  /** hold it until there's room: its line says why, and its chat gets a small card */
  hold(t: TaskRec, why: 'slots' | 'machine', go?: { text: string; why: string; plain?: boolean }) {
    const l = this.e.settings.machine()
    t.held = { why, since: t.held?.since ?? Date.now(), ...(go ? { go: go.text, goWhy: go.why, plain: go.plain } : {}) }
    t.after = undefined
    t.todo = undefined
    const id = `held:${t.id}:${Date.now()}`
    const words = why === 'slots' ? `waiting for a free slot (${this.e.workingOn(t.machine)} of ${l.max} working)` : 'waiting for the machine: it is busy'
    this.e.chats.post(this.e.key(t), { id, card: { id, task: t.id, status: 'queued', text: words } })
    this.e.save()
    this.e.settleOne(t)
  }

  env(key: string) {
    return agentEnv(key, ROOT)
  }

  /**
   * Its agent, in its herdr space. A worktree that is gone (a stop with no work put it away, or it was lost) is made again first from its
   * branch, here or on origin, in the same folder, so its agent's session (kept by folder) is found again; a finished task's when its branch kept work.
   */
  launch(t: TaskRec, first?: string, made?: Made, as?: Harness, restart?: () => Promise<string | void>) {
    return this.e.onMachineOf(t, () => this.launchHere(t, first, made, as, restart))
  }

  private async launchHere(t: TaskRec, first?: string, made?: Made, as?: Harness, restart?: () => Promise<string | void>) {
    const key = this.e.key(t)
    const rec = this.e.agents.record(key)
    const p = this.e.proj(t)
    const home = { repo: p.path, install: p.install }
    if (!made && (!ended(t) || !!t.kept?.some((k) => k.startsWith('branch '))) && !(await exists(t.worktree!)) && t.branch) {
      made = await this.e.wtOf(t).create(home, t.branch!, t.base!, t.worktree)
      t.worktree = made.path
      this.e.save()
    }
    const env = this.env(key)
    // a task from before tasks kept their own CLI starts on Settings'
    const h = t.agent ?? this.e.settings.harness('task', this.e.nameOf(t))
    const model = !as && !rec ? this.defaultModel(t, h) : undefined
    const spec: Spec = {
      access: 'full',
      key,
      name: rec?.name ?? `shep-${t.id.toLowerCase()}`,
      kind: as?.kind ?? rec?.kind ?? h.kind,
      // only its first start (or a backup's, on its CLI's own model): later, its own chat's pickers are what count
      ...(as ? { model: as.model ?? 'default', effort: as.effort } : rec ? {} : { model: model ?? h.model, effort: h.effort }),
      // what Settings said when it started on them: a change since is offered as a restart (restart.ts)
      ...(as || !rec ? { set: this.e.settings.harness('task', this.e.nameOf(t)) } : {}),
      cwd: t.worktree!,
      workspace: labelOf(t),
      tab: 'Agent',
      system:
        taskPrompt({ id: t.id, branch: t.branch!, base: t.base! }, pastTimes(this.e.data.tasks, t)) +
        '\n\n' +
        privatePrompt(this.e.settings.instructions('task', this.e.nameOf(t)), this.e.settings.instructions('reviewer', this.e.nameOf(t))),
      env,
      first,
      rpc: true,
    }
    // a start, not a message to a running agent that launch only heals
    if (!rec || restart || this.e.agents.status(key) === 'gone') recordWork(t.id, 'agent', undefined, t.machine ?? machineOf())
    return restart ? this.e.agents.restart(spec, restart) : this.e.agents.ensure(spec)
  }

  /** a first start with no model set takes the CLI's first listed one, and says so in the task's facts */
  private defaultModel(t: TaskRec, h: Harness) {
    if ((h.model && h.model !== 'default') || !chooseModel(h.kind, h.model)) return undefined
    const model = firstModel(h.kind)
    if (!model) return undefined
    t.facts = [t.facts, `No model was set for ${h.kind}: started on ${model}`].filter(Boolean).join(' · ')
    this.e.save()
    return model
  }
}
