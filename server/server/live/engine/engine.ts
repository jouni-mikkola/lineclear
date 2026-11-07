import { TaskIds } from '../task-ids.ts'
import type { Agents } from '../agents.ts'
import type { Chats } from '../chats.ts'
import { placeId, type Places } from '../places.ts'
import type { Settings } from '../settings.ts'
import { Worktrees, type HerdrSpaces } from './worktrees.ts'
import { EngineTidy } from './engine-tidy.ts'
import { type TaskRec, ended, RECHECK_FIRST, SWEEP_FIRST, SWEEP_EVERY, WATCH_FIRST, WATCH_EVERY, STALL_EVERY, LATER } from './engine-helpers.ts'
export type { TaskRec, Harness } from './engine-helpers.ts'
export { reportOf, ended, MERGE_DEADLINE, STALL_QUIET, SILENT_NEED, checkTitle } from './engine-helpers.ts'

export class Engine extends EngineTidy {
  constructor(agents: Agents, chats: Chats, places: Places, settings: Settings, h?: HerdrSpaces) {
    super(agents, chats, places, settings)
    this.taskIds = new TaskIds(this.places.spaces, this.data, (name) => placeId.space(name))
    this.places.takenTaskKeys = () => this.taskIds.keys()
    this.wt = new Worktrees(h)
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
        if (!t.desc.includes(LATER)) t.desc = `${t.desc || t.title}\n\n${LATER}`
        chain = chain.then(() => this.startTask(t)).catch((e) => this.troubled(t, e))
      }
    })
    queueMicrotask(() => this.endLostMerges())
    const recheck = setTimeout(() => this.resumeQueue(), RECHECK_FIRST)
    recheck.unref?.()
    this.sweeps.push(recheck)
    // a repo that gained its GitHub remote after it was added shows it from the start
    queueMicrotask(() =>
      Promise.all(this.places.spaces.map((p) => this.places.recheckGithub(p))).then(
        () => this.emit('changed'),
        () => undefined,
      ),
    )
    this.agents.taskEnded = (key) => {
      const t = this.endedKey(key) ? this.task(key.split('/')[0]) : undefined
      return t ? this.overWords(t) : undefined
    }
    // once herdr has told which agents are at work: a restart (main updated by a merge) cuts a clean-up short
    this.dropEndedOutbox()
    const tidy = () => {
      this.dropEndedOutbox()
      this.autoArchive()
      this.retireOld()
      this.sweep().catch(() => undefined)
    }
    const first = setTimeout(tidy, SWEEP_FIRST)
    const every = setInterval(tidy, SWEEP_EVERY)
    first.unref?.()
    every.unref?.()
    this.sweeps.push(first, every)
    const watch = () =>
      this.watchPrs()
        .then(() => this.landReady())
        .then(() => this.watchMains())
        .catch(() => undefined)
    const watchFirst = setTimeout(watch, WATCH_FIRST)
    const watchEvery = setInterval(watch, WATCH_EVERY)
    watchFirst.unref?.()
    watchEvery.unref?.()
    this.sweeps.push(watchFirst, watchEvery)
    const stalls = setInterval(() => {
      this.checkStalls()
      this.watchHeads().catch(() => undefined)
    }, STALL_EVERY)
    stalls.unref?.()
    this.sweeps.push(stalls)
  }
}
