import { chooseModel, firstModel } from '../../../../src/models.ts'
import { trustWorktree } from '../trust.ts'
import { existsSync } from '../mfs.ts'
import { agentEnv } from '../box.ts'
import type { Task } from '../../../shared/types.ts'
import { machineOf, recordWork } from '../../../../src/task-work.ts'
import { ROOT } from '../../root.ts'
import { hidden, type Spec } from '../agents.ts'
import { privatePrompt, taskFirst, taskPrompt } from '../prompts.ts'
import { pastTimes } from '../estimates.ts'
import type { Made } from './worktrees.ts'
import { type TaskRec, type Harness, ended, type DepState, splitRef, labelOf, BRIEF_WAIT } from './engine-helpers.ts'
import { EngineState } from './engine-state.ts'

/** what a task needs before its agent runs: the tasks it waits for, room on the machine, and the agent's start */
export abstract class EngineStart extends EngineState {
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
    const model = !as && !rec ? this.defaultModel(t, h) : undefined
    const spec: Spec = {
      access: 'full',
      key,
      name: rec?.name ?? `shep-${t.id.toLowerCase()}`,
      kind: as?.kind ?? rec?.kind ?? h.kind,
      // only its first start (or a backup's, on its CLI's own model): later, its own chat's pickers are what count
      ...(as ? { model: as.model ?? 'default', effort: as.effort } : rec ? {} : { model: model ?? h.model, effort: h.effort }),
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

  /** a first start with no model set takes the CLI's first listed one, and says so in the task's facts */
  private defaultModel(t: TaskRec, h: Harness) {
    if ((h.model && h.model !== 'default') || !chooseModel(h.kind, h.model)) return undefined
    const model = firstModel(h.kind)
    if (!model) return undefined
    t.facts = [t.facts, `No model was set for ${h.kind}: started on ${model}`].filter(Boolean).join(' · ')
    this.save()
    return model
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
}
