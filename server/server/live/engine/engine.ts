import { TaskIds } from '../task-ids.ts'
import type { Agents } from '../agents.ts'
import type { Chats } from '../chats.ts'
import { placeId, type Places } from '../places.ts'
import type { Settings } from '../settings.ts'
import { Worktrees } from './worktrees.ts'
import { EngineStart } from './engine-start.ts'
import { EngineStatus } from './status.ts'
import { EngineStalls } from './stalls.ts'
import { EngineLaunch } from './engine-launch.ts'
import { EnginePr } from './engine-pr.ts'
import { EngineHandoff } from './engine-handoff.ts'
import { EngineLand } from './merge.ts'
import { EngineMerge } from './engine-merge.ts'
import { EngineTidy } from './engine-tidy.ts'
import { EngineQueue } from './engine-queue.ts'
import { EngineMergeGitHub } from './merge-github.ts'
import { Core } from './engine-state.ts'
import { move } from './phase.ts'
import { Clock, every } from './clock.ts'
import { type TaskRec, ended, RECHECK_FIRST, SWEEP_FIRST, SWEEP_EVERY, WATCH_FIRST, WATCH_EVERY, STALL_EVERY, LATER } from './engine-helpers.ts'
export type { TaskRec, Harness } from './engine-helpers.ts'
export { reportOf, ended, MERGE_DEADLINE, STALL_QUIET, SILENT_NEED, checkTitle } from './engine-helpers.ts'

export class Engine extends Core {
  readonly startPart = new EngineStart(this)
  readonly statusPart = new EngineStatus(this)
  readonly stallsPart = new EngineStalls(this)
  readonly launchPart = new EngineLaunch(this)
  readonly prPart = new EnginePr(this)
  readonly handoffPart = new EngineHandoff(this)
  readonly landPart = new EngineLand(this)
  readonly mergePart = new EngineMerge(this)
  readonly tidyPart = new EngineTidy(this)
  readonly mergeGitHubPart = new EngineMergeGitHub(this)
  readonly queuePart = new EngineQueue(this)

  /** the one timer: first runs, hourly tidy, PR watch, head watch and the stall deadlines */
  readonly clock: Clock

  constructor(agents: Agents, chats: Chats, places: Places, settings: Settings) {
    super(agents, chats, places, settings)
    this.taskIds = new TaskIds(this.places.spaces, this.data, (name) => placeId.space(name))
    this.places.takenTaskKeys = () => this.taskIds.keys()
    this.wt = new Worktrees()
    let snapped = false
    // tasks from before statuses came from the agent: a finished one is merged, and was cleaned up then
    for (const t of this.data.tasks as (Omit<TaskRec, 'after'> & { stage?: string; after?: string | string[] })[]) {
      if (t.stage === 'done') Object.assign(t, { merged: true, cleaned: true })
      delete t.stage
      // Freeze older queued records before any space setting can change.
      if (!t.base) {
        t.base = this.places.space(t.project)?.base
        snapped ||= !!t.base
      }
      // Ready before the nudge existed: not nudged for a wait that began then
      if (t.reported && t.reportedAt && t.readyNudged === undefined) t.readyNudged = t.reportedAt
      // from an older way a task waited on another one's merge
      if (typeof t.after === 'string') delete t.after
      // from when the Watcher put what a task asks in a few words
      delete (t as { gist?: unknown }).gist
    }
    if (snapped) this.save()
    queueMicrotask(() => {
      // saved for later with no agent, before every task got one at once: its agent starts now and waits for a go
      let chain = Promise.resolve()
      for (const t of this.tasks.filter((t) => t.told === 'todo' && !t.worktree && !ended(t) && !t.trouble)) {
        // a start the last run was in the middle of is gone
        move(t, 'interrupted')
        if (!t.desc.includes(LATER)) t.desc = `${t.desc || t.title}\n\n${LATER}`
        chain = chain.then(() => this.launchPart.startTask(t)).catch((e) => this.launchPart.troubled(t, e))
      }
    })
    queueMicrotask(() => this.landPart.endLostMerges())
    // a repo that gained its GitHub remote after it was added shows it from the start
    queueMicrotask(() =>
      Promise.all(this.places.spaces.map((p) => this.places.recheckGithub(p))).then(
        () => this.emit('changed'),
        () => undefined,
      ),
    )
    this.agents.taskEnded = (key) => {
      const t = this.handoffPart.endedKey(key) ? this.task(key.split('/')[0]) : undefined
      return t ? this.overWords(t) : undefined
    }
    // once herdr has told which agents are at work: a restart (main updated by a merge) cuts a clean-up short
    this.handoffPart.dropEndedOutbox()
    const tidy = () => {
      this.handoffPart.dropEndedOutbox()
      this.autoArchive()
      this.retireOld()
      this.sweep().catch(() => undefined)
    }
    const watch = () =>
      this.watchPrs()
        .then(() => this.watchMains())
        .then(() => this.landReady())
        .catch(() => undefined)
    this.clock = new Clock(
      [
        every(RECHECK_FIRST, undefined, () => this.resumeQueue()),
        every(SWEEP_FIRST, SWEEP_EVERY, tidy),
        every(WATCH_FIRST, WATCH_EVERY, watch),
        { due: () => this.nextStallDue(), run: (now) => this.checkStalls(now) },
      ],
      STALL_EVERY,
    )
    this.clock.start()
  }

  outcomeOf(...a: Parameters<EngineStart['outcomeOf']>): ReturnType<EngineStart['outcomeOf']> {
    return this.startPart.outcomeOf(...a)
  }
  open(...a: Parameters<EngineStart['open']>): ReturnType<EngineStart['open']> {
    return this.startPart.open(...a)
  }
  working(...a: Parameters<EngineStart['working']>): ReturnType<EngineStart['working']> {
    return this.startPart.working(...a)
  }
  workingOn(...a: Parameters<EngineStart['workingOn']>): ReturnType<EngineStart['workingOn']> {
    return this.startPart.workingOn(...a)
  }
  room(...a: Parameters<EngineStart['room']>): ReturnType<EngineStart['room']> {
    return this.startPart.room(...a)
  }
  heldTasks(...a: Parameters<EngineStart['heldTasks']>): ReturnType<EngineStart['heldTasks']> {
    return this.startPart.heldTasks(...a)
  }
  launch(...a: Parameters<EngineStart['launch']>): ReturnType<EngineStart['launch']> {
    return this.startPart.launch(...a)
  }
  statusOf(...a: Parameters<EngineStatus['statusOf']>): ReturnType<EngineStatus['statusOf']> {
    return this.statusPart.statusOf(...a)
  }
  subOf(...a: Parameters<EngineStatus['subOf']>): ReturnType<EngineStatus['subOf']> {
    return this.statusPart.subOf(...a)
  }
  nextStallDue(...a: Parameters<EngineStalls['nextStallDue']>): ReturnType<EngineStalls['nextStallDue']> {
    return this.stallsPart.nextStallDue(...a)
  }
  checkStalls(...a: Parameters<EngineStalls['checkStalls']>): ReturnType<EngineStalls['checkStalls']> {
    return this.stallsPart.checkStalls(...a)
  }
  settle(...a: Parameters<EngineLaunch['settle']>): ReturnType<EngineLaunch['settle']> {
    return this.launchPart.settle(...a)
  }
  view(...a: Parameters<EngineLaunch['view']>): ReturnType<EngineLaunch['view']> {
    return this.launchPart.view(...a)
  }
  add(...a: Parameters<EngineLaunch['add']>): ReturnType<EngineLaunch['add']> {
    return this.launchPart.add(...a)
  }
  todo(...a: Parameters<EngineLaunch['todo']>): ReturnType<EngineLaunch['todo']> {
    return this.launchPart.todo(...a)
  }
  push(...a: Parameters<EnginePr['push']>): ReturnType<EnginePr['push']> {
    return this.prPart.push(...a)
  }
  openPr(...a: Parameters<EnginePr['openPr']>): ReturnType<EnginePr['openPr']> {
    return this.prPart.openPr(...a)
  }
  resume(...a: Parameters<EngineHandoff['resume']>): ReturnType<EngineHandoff['resume']> {
    return this.handoffPart.resume(...a)
  }
  restart(...a: Parameters<EngineHandoff['restart']>): ReturnType<EngineHandoff['restart']> {
    return this.handoffPart.restart(...a)
  }
  sent(...a: Parameters<EngineHandoff['sent']>): ReturnType<EngineHandoff['sent']> {
    return this.handoffPart.sent(...a)
  }
  plan(...a: Parameters<EngineHandoff['plan']>): ReturnType<EngineHandoff['plan']> {
    return this.handoffPart.plan(...a)
  }
  report(...a: Parameters<EngineHandoff['report']>): ReturnType<EngineHandoff['report']> {
    return this.handoffPart.report(...a)
  }
  alive(...a: Parameters<EngineHandoff['alive']>): ReturnType<EngineHandoff['alive']> {
    return this.handoffPart.alive(...a)
  }
  done(...a: Parameters<EngineHandoff['done']>): ReturnType<EngineHandoff['done']> {
    return this.handoffPart.done(...a)
  }
  overWords(...a: Parameters<EngineHandoff['overWords']>): ReturnType<EngineHandoff['overWords']> {
    return this.handoffPart.overWords(...a)
  }
  close(...a: Parameters<EngineHandoff['close']>): ReturnType<EngineHandoff['close']> {
    return this.handoffPart.close(...a)
  }
  holds(...a: Parameters<EngineHandoff['holds']>): ReturnType<EngineHandoff['holds']> {
    return this.handoffPart.holds(...a)
  }
  pause(...a: Parameters<EngineHandoff['pause']>): ReturnType<EngineHandoff['pause']> {
    return this.handoffPart.pause(...a)
  }
  landAtReady(...a: Parameters<EngineLand['landAtReady']>): ReturnType<EngineLand['landAtReady']> {
    return this.landPart.landAtReady(...a)
  }
  landReady(...a: Parameters<EngineLand['landReady']>): ReturnType<EngineLand['landReady']> {
    return this.landPart.landReady(...a)
  }
  merge(...a: Parameters<EngineLand['merge']>): ReturnType<EngineLand['merge']> {
    return this.landPart.merge(...a)
  }
  drain(...a: Parameters<EngineLand['drain']>): ReturnType<EngineLand['drain']> {
    return this.landPart.drain(...a)
  }
  mergeNow(...a: Parameters<EngineLand['mergeNow']>): ReturnType<EngineLand['mergeNow']> {
    return this.landPart.mergeNow(...a)
  }
  youWrote(...a: Parameters<EngineLand['youWrote']>): ReturnType<EngineLand['youWrote']> {
    return this.landPart.youWrote(...a)
  }
  checks(...a: Parameters<EngineMerge['checks']>): ReturnType<EngineMerge['checks']> {
    return this.mergePart.checks(...a)
  }
  watchPrs(...a: Parameters<EngineMerge['watchPrs']>): ReturnType<EngineMerge['watchPrs']> {
    return this.mergePart.watchPrs(...a)
  }
  watchMains(...a: Parameters<EngineMerge['watchMains']>): ReturnType<EngineMerge['watchMains']> {
    return this.mergePart.watchMains(...a)
  }
  watchMain(...a: Parameters<EngineMerge['watchMain']>): ReturnType<EngineMerge['watchMain']> {
    return this.mergePart.watchMain(...a)
  }
  sweep(...a: Parameters<EngineMerge['sweep']>): ReturnType<EngineMerge['sweep']> {
    return this.mergePart.sweep(...a)
  }
  keptLeftovers(...a: Parameters<EngineMerge['keptLeftovers']>): ReturnType<EngineMerge['keptLeftovers']> {
    return this.mergePart.keptLeftovers(...a)
  }
  tell(...a: Parameters<EngineTidy['tell']>): ReturnType<EngineTidy['tell']> {
    return this.tidyPart.tell(...a)
  }
  unstarted(...a: Parameters<EngineTidy['unstarted']>): ReturnType<EngineTidy['unstarted']> {
    return this.tidyPart.unstarted(...a)
  }
  stopTask(...a: Parameters<EngineTidy['stopTask']>): ReturnType<EngineTidy['stopTask']> {
    return this.tidyPart.stopTask(...a)
  }
  deleteTask(...a: Parameters<EngineTidy['deleteTask']>): ReturnType<EngineTidy['deleteTask']> {
    return this.tidyPart.deleteTask(...a)
  }
  archive(...a: Parameters<EngineTidy['archive']>): ReturnType<EngineTidy['archive']> {
    return this.tidyPart.archive(...a)
  }
  pin(...a: Parameters<EngineTidy['pin']>): ReturnType<EngineTidy['pin']> {
    return this.tidyPart.pin(...a)
  }
  retireOld(...a: Parameters<EngineTidy['retireOld']>): ReturnType<EngineTidy['retireOld']> {
    return this.tidyPart.retireOld(...a)
  }
  autoArchive(...a: Parameters<EngineTidy['autoArchive']>): ReturnType<EngineTidy['autoArchive']> {
    return this.tidyPart.autoArchive(...a)
  }
  routeRecovered(...a: Parameters<EngineTidy['routeRecovered']>): ReturnType<EngineTidy['routeRecovered']> {
    return this.tidyPart.routeRecovered(...a)
  }
  agentStatus(...a: Parameters<EngineTidy['agentStatus']>): ReturnType<EngineTidy['agentStatus']> {
    return this.tidyPart.agentStatus(...a)
  }
  count(...a: Parameters<EngineTidy['count']>): ReturnType<EngineTidy['count']> {
    return this.tidyPart.count(...a)
  }
  recheck(...a: Parameters<EngineQueue['recheck']>): ReturnType<EngineQueue['recheck']> {
    return this.queuePart.recheck(...a)
  }
  resumeQueue(...a: Parameters<EngineQueue['resumeQueue']>): ReturnType<EngineQueue['resumeQueue']> {
    return this.queuePart.resumeQueue(...a)
  }
  go(...a: Parameters<EngineQueue['go']>): ReturnType<EngineQueue['go']> {
    return this.queuePart.go(...a)
  }
  queue(...a: Parameters<EngineQueue['queue']>): ReturnType<EngineQueue['queue']> {
    return this.queuePart.queue(...a)
  }
  release(...a: Parameters<EngineQueue['release']>): ReturnType<EngineQueue['release']> {
    return this.queuePart.release(...a)
  }
  get releaseHead() {
    return this.tidyPart.releaseHead
  }

  stop() {
    this.clock.stop()
    super.stop()
  }
}
