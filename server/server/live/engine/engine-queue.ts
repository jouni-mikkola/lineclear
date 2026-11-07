import type { Engine } from './engine.ts'
import { hidden } from '../agents.ts'
import { goLine, queuedLine } from '../prompts.ts'
import { type TaskRec, ended, splitRef, START_GAP } from './engine-helpers.ts'
import { move } from './phase.ts'

/** the tasks queued after others: their order, their go and the merge lines' release */
export class EngineQueue {
  constructor(private readonly e: Engine) {}

  /** a Done task is about to be deleted: those queued after it no longer wait for it, and the one that waited only
   *  for it is told to go (a deleted task is "gone", which would hold it for good) */
  passOn(t: TaskRec) {
    const notes = this.e.startPart.notes([t.id])
    for (const d of this.e.tasks.filter((d) => d !== t && this.e.startPart.queued(d) && d.after!.includes(t.id))) {
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
    if (this.e.checking) return
    this.e.checking = true
    try {
      for (const t of this.e.tasks.filter((t) => this.e.startPart.queued(t))) {
        if (!this.e.open(t).length)
          this.goWhenRoom(t, goLine(t.after!, this.e.startPart.notes(t.after!)), `${t.after!.join(', ')} ${t.after!.length === 1 ? 'is' : 'are'} done`)
        else if (this.e.statusOf(t) !== t.told) this.e.settleOne(t)
      }
    } finally {
      this.e.checking = false
    }
  }

  /**
   * After a start: a go that never reached its agent (a restart cut it off) is sent again; then the queue is checked.
   */
  resumeQueue() {
    this.e.endPhases()
    for (const t of this.e.tasks.filter((t) => t.going && !ended(t) && !t.stopped && this.e.agents.status(this.e.key(t)) !== 'working'))
      this.e.agents.send(this.e.key(t), hidden(t.going!, 'go'), { ensure: () => this.e.launch(t) }).catch((e) => this.e.launchPart.troubled(t, e))
    this.e.recheck()
  }

  /** the go: its agent hears it (hidden from the chat, where a small card says why it started) and starts on the work */
  go(t: TaskRec, text: string, why: string, plain = false) {
    // archived while it waited: it starts work, so it shows again
    if (t.archived) this.e.unarchive(t.id)
    t.after = undefined
    t.held = undefined
    t.todo = undefined
    t.reported = false
    move(t, 'brief-over')
    // a coordinator's own words go in as they are, and are not sent again after a restart
    t.going = plain ? undefined : text
    this.e.wrote.set(t.id, Date.now())
    this.e.answering.add(t.id)
    const key = this.e.key(t)
    const id = `go:${t.id}:${Date.now()}`
    this.e.chats.post(key, { id, card: { id, task: t.id, status: 'work', text: `started: ${why}` } })
    this.e.save()
    this.e.agents.send(key, plain ? text : hidden(text, 'go'), { ensure: () => this.e.launch(t) }).catch((e) => this.e.launchPart.troubled(t, e))
    this.e.settleOne(t)
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
        if (!this.e.peerTask) throw new Error(`${raw}: only the main machine sees other machines' tasks, so only its tasks can wait for them`)
        const x = this.e.peerTask(machine, id)
        if (x === 'unknown') throw new Error(`${raw}: no machine called ${machine}`)
        if (x === 'away') throw new Error(`${raw}: can't reach ${machine} right now, so it can't be checked; try again later`)
        if (!x) throw new Error(`${raw}: ${machine} has no task ${id}`)
        ref = `${machine}:${x.id}`
      } else {
        const d = this.e.task(id)
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
  circle(self: string, ref: string, path: string[]): string[] | undefined {
    if (splitRef(ref)[0]) return undefined
    const d = this.e.task(ref)
    if (!d) return undefined
    if (d.id.toUpperCase() === self.toUpperCase()) return [...path, d.id]
    if (path.includes(d.id)) return undefined
    for (const next of this.e.startPart.queued(d) ? d.after! : []) {
      const loop = this.circle(self, next, [...path, d.id])
      if (loop) return loop
    }
  }

  /**
   * Queue a task after others, change what it waits for, or (none) clear it. Its agent is told: to hold on (it may be
   * at work), what it waits for now, or to go. `self`: its own agent asked, and needs no message for it.
   */
  queue(id: string, refs: string[], opts: { self?: boolean } = {}): { queued: string[]; went?: boolean } {
    const t = this.e.req(id)
    if (ended(t)) throw new Error(`${t.id} is Done already (${t.closed ? 'nothing to merge' : 'merged'})`)
    const after = this.checkAfter(t.id, refs)
    const was = this.e.startPart.queued(t) ? t.after! : []
    const open = after.filter((ref) => this.e.startPart.depState(ref) !== 'done')
    if (!open.length) {
      if (!was.length) return { queued: [] }
      if (after.length) this.goWhenRoom(t, goLine(after, this.e.startPart.notes(after)), `${after.join(', ')} ${after.length === 1 ? 'is' : 'are'} done`)
      else this.goWhenRoom(t, goLine(was, [], true), `no longer waits for ${was.join(', ')}`)
      return { queued: [], went: true }
    }
    t.after = after
    t.stopped = undefined
    const key = this.e.key(t)
    const cid = `queued:${t.id}:${Date.now()}`
    this.e.chats.post(key, { id: cid, card: { id: cid, task: t.id, status: 'queued', text: `queued after ${open.join(', ')}` } })
    this.e.save()
    if (!opts.self && this.e.agents.status(key) !== 'gone')
      this.e.agents
        .send(key, hidden(queuedLine(open, was.length ? 'changed' : 'later', t.id), 'queue'), { ensure: () => this.e.launch(t) })
        .catch((e) => this.e.launchPart.troubled(t, e))
    this.e.settleOne(t)
    return { queued: open }
  }

  /** the go, now if this machine has room, else once it has */
  goWhenRoom(t: TaskRec, text: string, why: string, plain = false) {
    const r = this.e.startPart.roomFor(t)
    if (r.why) return this.e.startPart.hold(t, r.why, { text, why, plain })
    if (!t.worktree) t.machine = r.machine
    this.e.go(t, text, why, plain)
  }

  /**
   * Start held tasks while this machine has room, oldest first. While load decides, one at a time, START_GAP apart:
   * the load average takes a moment to show what a task adds. Called on each health sample and status change.
   */
  release(now = Date.now()) {
    if (this.e.releasing) return
    this.e.releasing = true
    try {
      const byLoad = this.e.settings.machine().startLoad !== null
      for (const t of this.e.heldTasks()) {
        const r = this.e.startPart.roomFor(t)
        if (r.why) {
          // its line says the reason that holds it now
          if (t.held!.why !== r.why) {
            t.held!.why = r.why
            this.e.save()
          }
          continue
        }
        if (byLoad && now - this.e.lastStart < START_GAP) return
        this.e.lastStart = now
        if (!t.worktree) t.machine = r.machine
        const why = t.held!.why === 'slots' ? 'a slot is free' : 'the machine has room'
        if (t.held!.go) this.e.go(t, t.held!.go, `${t.held!.goWhy ?? why} · ${why}`, t.held!.plain)
        else {
          t.held = undefined
          const id = `go:${t.id}:${now}`
          this.e.chats.post(this.e.key(t), { id, card: { id, task: t.id, status: 'work', text: `started: ${why}` } })
          this.e.save()
          this.e.launchPart.startTask(t).catch((e) => this.e.launchPart.troubled(t, e))
        }
      }
    } finally {
      this.e.releasing = false
    }
  }
}
