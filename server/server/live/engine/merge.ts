import type { Engine } from './engine.ts'
import { exists } from '../mfs.ts'
import { hidden } from '../agents.ts'
import * as G from './git.ts'
import type * as GH from './github.ts'
import * as Lane from './lane.ts'
import { type TaskRec, ended, LAND_RETRY } from './engine-helpers.ts'

/** how long a ready task's agent may finish its turn before the board merges without ending it */
const TURN_END_WAIT_MS = 2 * 60_000

const HELD = 'Held:'

export class EngineLand {
  constructor(private readonly e: Engine) {}

  /**
   * On its way into main, its agent at rest with nothing left running to wake it, and GitHub's checks through: it is
   * told once to merge, so it never shows Merging while nothing happens.
   */
  async nudgeToMerge(t: TaskRec, n: number, c: GH.PrChecks) {
    const key = this.e.key(t)
    if (!t.landing || t.landing.nudged || (c.state !== 'pass' && c.state !== 'none')) return
    t.landing.nudged = true
    this.e.save()
    // its process ended at ready (landAtReady): the board merges, there is no agent to tell
    if (this.e.agents.record(key)?.finished) return void this.e.merge(t.id).catch(() => undefined)
    const text = `GitHub's checks passed on PR #${n}: merge ${t.id} now (lineclear merge ${t.id}), as your brief says.`
    await this.e.agents.send(key, hidden(text, 'github', { task: t.id, pr: String(n) }), { ensure: () => this.e.launch(t) }).catch(() => undefined)
  }

  /**
   * Its agent reported ready and merging is the board's (Settings): once the agent's turn ends its process ends, and the
   * board merges the branch. Only a refusal (a red check, a conflict) starts the agent again, through sendBack, with the
   * failing lines. An agent that merges itself first, or works again, is left alone.
   */
  landAtReady(id: string): boolean {
    const t = this.e.req(id)
    if (t.askFirst || this.e.settings.ways(this.e.proj(t).name).merge === 'ask me first') return false
    void this.endAndMerge(t).catch(() => undefined)
    return true
  }

  /**
   * Every look at the board: a task at Ready to merge whose agent is at rest is merged by the engine, which rebases
   * itself on a conflict. A conflict the rebase cannot settle goes back to the agent and opens one card, once.
   */
  async landReady() {
    if (this.e.closing) return
    const waiting = this.e.tasks.filter((t) => this.e.statusOf(t) === 'ready' && !t.archived && !t.landing && !this.e.landings.has(t.id))
    for (const t of waiting) {
      if (t.askFirst || this.e.settings.ways(this.e.proj(t).name).merge === 'ask me first') continue
      if (Date.now() - (t.landTriedAt ?? 0) < LAND_RETRY) continue
      // held by a red main: nothing to try until the watch sees main green
      if (t.mergeStopped?.startsWith(HELD) && this.redOf(t)) continue
      // not waited for: a merge held by a red main must not hold up the watch that turns main green
      void this.e.merge(t.id).then(
        (r) => this.landed(t, r),
        () => undefined,
      )
    }
  }

  private landed(t: TaskRec, r: { ok: boolean; error?: string }) {
    t.landTriedAt = r.ok ? undefined : Date.now()
    // only the rebase that failed: main moving on GitHub meanwhile is rebased by the next try
    const clash = /^Conflict with \S+: rebase .* Conflicting files: (.*)\. Sent back to/.exec(r.error ?? '')
    if (clash && !t.landCard) {
      t.landCard = true
      const id = `land:${t.id}`
      this.e.chats.post(this.e.key(t), {
        id,
        card: { id, task: t.id, status: 'need', text: `conflict with ${t.base} the rebase could not settle: ${clash[1]}`, pr: t.pr },
      })
    }
    this.e.save()
  }

  private async endAndMerge(t: TaskRec) {
    const key = this.e.key(t)
    await this.turnEnded(key)
    if (this.e.agents.status(key) === 'working' || !t.reported || ended(t) || t.landing || this.e.landings.has(t.id)) return
    // a note not read yet would wait for a process that is gone: leave the agent be, it reads the note and merges
    if (this.e.chats.unseen(key).length) return
    await this.e.agents.finish(key).catch(() => undefined)
    await this.e.merge(t.id)
  }

  /** resolves when the agent's turn ends (its status changes) or after the wait, whichever is first */
  private turnEnded(key: string): Promise<void> {
    if (this.e.agents.status(key) !== 'working') return Promise.resolve()
    return new Promise((done) => {
      const finish = () => {
        clearTimeout(timer)
        off()
        done()
      }
      const timer = setTimeout(finish, TURN_END_WAIT_MS)
      const off = this.e.agents.on('status', (k) => (k === key || k === '*') && this.e.agents.status(key) !== 'working' && finish())
    })
  }

  /**
   * Rebase the task's branch on main, squash-merge it into main and mark it merged: through its pull request on a
   * GitHub repo gh is logged in to, else here. Its agent and worktree are put away once the agent's turn ends (it may
   * be the one asking). A conflict or failed checks stop it with what to do. Anyone but the task's own agent waits
   * until that agent's turn has ended, so no half-done work goes in.
   */
  merge(id: string, opts: { self?: boolean } = {}): Promise<{ ok: boolean; error?: string; note?: string }> {
    const t = this.e.req(id)
    if (this.e.closing)
      return Promise.resolve({ ok: false, error: `Lineclear is restarting: nothing was merged. Run lineclear merge ${t.id} again in a minute.` })
    // asked again while its merge still runs: the same one is waited for, never a second beside it
    let run = this.e.landings.get(t.id)
    if (!run) {
      const repo = this.e.places.space(t.project)?.path ?? ''
      const now = (this.e.merging.get(repo) ?? Promise.resolve())
        .then(() => this.head(t, repo, !!opts.self))
        // stopped short with nothing more to wait for (failed checks, GitHub refused): Ready again, or back at work
        .then(async (r) => {
          if (!r.ok && t.landing?.step === 'merge') this.e.prPart.land(t)
          // what task show says when the caller never heard
          t.mergeStopped = r.ok ? undefined : (r.error ?? 'Merge failed.').slice(0, 300)
          this.e.save()
          // over before its caller hears: one asking right after starts a merge of its own, never joins this answer
          this.e.landings.delete(t.id)
          return Lane.tellIfLeft(this.e.callerLeft.delete(t.id), r, (m) => this.e.mergeGitHubPart.sendBack(t, m))
        })
      run = now
      this.e.landings.set(t.id, now)
      const tail = now.catch(() => undefined)
      tail.then(() => this.e.landings.get(t.id) === now && this.e.landings.delete(t.id))
      // the next merge into this repo waits until this one is really through, however long: two at once would write
      // over each other's main
      this.e.merging.set(repo, tail)
      tail.then(() => this.e.merging.get(repo) === tail && this.e.merging.delete(repo))
    }
    // its caller waits for the end, merged or stopped with a reason, however long git, GitHub or the check line take.
    // Past the deadline it may be gone (its shell moved it to the background): an error is then also sent to the agent
    const late = setTimeout(() => this.e.landings.has(t.id) && this.e.callerLeft.add(t.id), this.e.mergeDeadline)
    return run.finally(() => clearTimeout(late))
  }

  /** a task's merge while it holds its repo's lane: the head, which the lane lets go past its limit (releaseHead) */
  async head(t: TaskRec, repo: string, self: boolean): Promise<{ ok: boolean; error?: string; note?: string }> {
    const ctl = new AbortController()
    const limit = this.e.headLimitMs ?? Lane.turnLimitMs(repo)
    const freed = new Promise<{ ok: false; error: string; freed: true }>((free) => this.e.frees.set(t.id, free))
    // over its limit the lane lets it go: its steps end with their process groups and the next head starts
    const timer = setTimeout(() => void this.e.releaseHead(t, ctl, limit).catch(() => undefined), limit)
    const work = G.stepSignal.run(ctl.signal, () =>
      this.e.prPart.onGitHub(
        () => this.e.mergeNow(t, self),
        (error) => ({ ok: false, error: `Can't merge ${t.id}: ${error}` }),
      ),
    )
    // a released run ends on its own later, its error is nobody's
    work.catch(() => undefined)
    try {
      const r = await Promise.race([work, freed])
      if (!('freed' in r)) this.e.released.delete(t.id)
      return r
    } finally {
      clearTimeout(timer)
      this.e.frees.delete(t.id)
    }
  }

  /** A merge cut short by a restart ends as stopped: Ready again, with the reason, never Merging for good. */
  endLostMerges() {
    for (const t of this.e.tasks.filter((t) => t.landing && !ended(t))) {
      t.mergeStopped = 'Lineclear restarted before its merge was through; nothing was merged, run lineclear merge again.'
      this.e.prPart.land(t)
    }
  }

  /**
   * Lineclear stops (an update restarts it, as one right after a merge into its own repo does): the merges on their
   * way finish first, at most their deadline, so none is cut halfway (merged on GitHub, never marked, its agent never
   * told). A caller whose merge goes on longer asks again; that joins the merge or finds it merged. No new one starts meanwhile. True when there was one to wait for.
   */
  async drain(): Promise<boolean> {
    this.e.closing = true
    const on = [...this.e.landings.values()]
    if (!on.length) return false
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([Promise.allSettled(on), new Promise((r) => (timer = setTimeout(r, this.e.mergeDeadline)))])
    clearTimeout(timer)
    return true
  }

  async mergeNow(t: TaskRec, self: boolean): Promise<{ ok: boolean; error?: string; note?: string }> {
    return this.e.onMachineOf(t, () => this.mergeOnMachine(t, self))
  }

  private async mergeOnMachine(t: TaskRec, self: boolean): Promise<{ ok: boolean; error?: string; note?: string }> {
    // asked again after its first answer was lost: the merge is the answer
    if (t.merged) return { ok: true, note: `${t.id} is merged already` }
    if (t.closed) return { ok: false, error: `${t.id} is Done: it had nothing to merge` }
    if (!t.worktree || !t.branch || !t.base) return { ok: false, error: `${t.id} has no branch yet` }
    if (!self && this.e.agents.status(this.e.key(t)) === 'working')
      return { ok: false, error: `${t.id}'s agent is working: wait for its turn to end, or ask it to merge (lineclear task tell ${t.id} "merge it").` }
    // a late note from you or a coordinator, not read yet, may change what goes in
    if (this.e.chats.unseen(this.e.key(t)).length)
      return {
        ok: false,
        error: self
          ? 'You have a new message in your chat: read and handle it, then merge again.'
          : `${t.id}'s agent has a new message it hasn't read yet: let it handle that first.`,
      }
    // land() only shows a ready task: one whose agent never reported done (a worker machine's, whose report did not
    // arrive) is ready by being merged, or its landing would never show and the lane would give up at once
    if (!t.reported) {
      t.reported = true
      t.reportedAt ??= Date.now()
    }
    this.e.prPart.land(t, 'merge')
    const p = this.e.proj(t)
    const wt = t.worktree
    // a folder removed under the merge (a temp dir cleaned away) would only show as a git that "can't be found"
    const gone = (await Promise.all([p.path, wt].map(async (d) => ((await exists(d)) ? undefined : d)))).find(Boolean)
    if (gone) return { ok: false, error: `Can't merge ${t.id}: the folder ${gone} is gone.` }
    // main here first catches up with the remote's, so the branch is rebased on what main really is
    const up = await G.catchUp(p.path, t.base)
    if (!up.ok) return { ok: false, error: `Can't merge ${t.id}: ${up.err}` }
    await G.commitAll(wt, `${t.id}: ${t.title}`)
    // a conflict solved halfway and committed: it never reaches main
    const marked = await G.conflictMarkers(wt, t.base)
    if (marked.length)
      return {
        ok: false,
        error: `Can't merge ${t.id}: ${marked.join(', ')} still ${marked.length === 1 ? 'has' : 'have'} conflict markers (<<<<<<<, =======, >>>>>>>). Solve them, commit, then merge again.`,
      }
    const gated = await Lane.smokeGate(t.worktree, t.base, async (m) => {
      this.e.prPart.land(t)
      return this.sendBackOrTell(t, self, m.replace('{id}', t.id))
    })
    if (gated) return gated
    const g = await this.e.prPart.hub(p)
    if (g) return this.e.mergeGitHubPart.mergeOnGitHub(t, p, g, self)
    // its pull request is open, but gh can't use GitHub here now: it is never merged around it
    if (t.pr)
      return {
        ok: false,
        error: `Can't merge ${t.id}: its PR #${t.pr.number} is on GitHub, but gh isn't signed in to it here (gh auth login), so nothing was merged.`,
      }
    // nothing ahead of main and no work ever made here; work merged by a merge commit (a pull request) is behind it too
    if ((await G.aheadCount(wt, t.base)) === 0 && !(await G.workedOn(wt, t.branch))) return { ok: false, error: `${t.id} has no changes to merge` }
    let note: string | undefined
    // merged already, by hand or as its pull request on GitHub (squashed, or with a merge commit), even with main
    // moved on since: it only needs marking
    if (await G.landed(wt, 'HEAD', t.base)) note = `it was in ${t.base} already`
    else {
      const rb = await G.rebase(wt, t.base)
      if (!rb.ok) return this.conflict(t, self, (await Lane.conflictFiles(wt, t.base)) ?? (await Lane.sharedFiles(wt, t.base)))
      const message = `${t.id}: ${t.title}${t.said ? `\n\n${t.said}` : ''}`
      const m = await G.mergeHere(p.path, t.branch, t.base, message, true)
      if (!m.ok) {
        if (/conflict/i.test(`${m.out}${m.err}`)) this.e.prPart.land(t, 'rebase')
        return { ok: false, error: /conflict/i.test(`${m.out}${m.err}`) ? `Conflict with ${t.base}` : `Merge failed: ${(m.err || m.out).split('\n')[0]}` }
      }
      t.squash = (await G.git(p.path, 'rev-parse', '--verify', '--quiet', `refs/heads/${t.base}`)).out || undefined
    }
    // a GitHub remote gh can't use, or any other origin: main is pushed as it is here, since Lineclear reads it there
    if (p.github || (await G.git(p.path, 'remote', 'get-url', 'origin')).ok) {
      const [push, where] = [await G.git(p.path, 'push', '--quiet', 'origin', t.base), p.github ? 'GitHub' : 'origin']
      const pushed = push.ok ? `pushed ${t.base} to ${where}` : `could not push ${t.base} to ${where}: ${push.err.split('\n')[0]}`
      note = note ? `${note}; ${pushed}` : pushed
    }
    return this.e.mergeGitHubPart.markMerged(t, note)
  }

  /** an error for the caller; anyone but the task's own agent also sends it to the agent */
  async sendBackOrTell(t: TaskRec, self: boolean, error: string) {
    if (self && !this.e.callerLeft.has(t.id)) return { ok: false as const, error }
    await this.e.mergeGitHubPart.sendBack(t, error)
    return { ok: false as const, error: `${error} Sent back to ${t.id}'s agent to fix.` }
  }

  /** a conflict with main goes back to the task's agent with the files that clash */
  async conflict(t: TaskRec, self: boolean, files: string[]) {
    this.e.prPart.land(t, 'rebase')
    return this.sendBackOrTell(
      t,
      self,
      `Conflict with ${t.base}: rebase ${t.branch} on ${t.base} by hand, commit, then run lineclear merge ${t.id} again. Conflicting files: ${files.join(', ')}.`,
    )
  }

  /**
   * A main red in the required check stops the merges (another workflow's failure files a fix task and holds nothing),
   * so a burst of failures stays one. A fix (its task is made by main-green) goes in, as only it can turn main green.
   * Anything else is refused at once with the reason, never waited for: a waiting merge would hold the repo's lane and
   * the fix behind it. The board tries again once the main watch sees main green.
   */
  async holdWhileRed(t: TaskRec): Promise<string | undefined> {
    if (t.by === 'main-green') return undefined
    const sha = this.redOf(t)
    if (!sha) return undefined
    const fix = this.e.tasks.find((x) => x.by === 'main-green' && !x.merged && !x.archived && x.project === t.project)
    return `${HELD} ${t.base} is red at ${sha.slice(0, 7)}${fix ? `, fix task ${fix.id}` : ''}. Nothing was merged; ${t.id} lands by itself once ${t.base} is green.`
  }

  /** the commit main is red at in the required check, from what the main watch last saw: no call to GitHub */
  private redOf(t: TaskRec): string | undefined {
    return this.e.heldRed.get(this.e.places.space(t.project)?.path ?? '')
  }

  /** a message sent to a task agent asks something of it: it is working again, not done. `go`: false for an answer in
   *  its CLI's own menu or question, which is no go for a queued task */
  youWrote(key: string, { go = true } = {}) {
    const [id] = key.split('/')
    const t = this.e.task(id)
    if (!t) return
    // writing to an archived task brings it back: you talk to it again
    if (t.archived) this.e.unarchive(t.id)
    if (ended(t)) return
    t.reported = false
    t.landing = undefined
    t.stopped = undefined
    // talking to it is the go, or a change to the brief: it says so again if it still waits. Queued, it stays so: its
    // agent decides from the words whether they are a go, and clears its queue itself (task queue --after none)
    t.todo = undefined
    t.paused = undefined
    t.going = undefined
    // what it was held with is said already, or overtaken by what you wrote
    if (go) t.held = undefined
    this.e.wrote.set(t.id, Date.now())
    this.e.answering.add(t.id)
    this.e.settle(t)
  }
}
