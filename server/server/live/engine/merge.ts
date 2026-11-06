import { existsSync } from '../mfs.ts'
import { hidden } from '../agents.ts'
import type { Space } from '../places.ts'
import * as G from './git.ts'
import * as GH from './github.ts'
import * as Lane from './lane.ts'
import * as Runs from '../../../../src/check-runs.ts'
import { type TaskRec, ended, ANSWER_GRACE, CHECKS_EVERY } from './engine-helpers.ts'
import { EngineHandoff } from './engine-handoff.ts'

/** how long a merge waits for a merge queue to run its check and merge the pull request */
const QUEUE_WAIT_MS = 15 * 60_000

export class EngineLand extends EngineHandoff {
  /**
   * On its way into main, its agent at rest with nothing left running to wake it, and GitHub's checks through: it is
   * told once to merge, so it never shows Merging while nothing happens.
   */
  protected async nudgeToMerge(t: TaskRec, n: number, c: GH.PrChecks) {
    const key = this.key(t)
    if (!t.landing || t.landing.nudged || (c.state !== 'pass' && c.state !== 'none') || this.agents.background(key)) return
    t.landing.nudged = true
    this.save()
    const text = `GitHub's checks passed on PR #${n}: merge ${t.id} now (lineclear merge ${t.id}), as your brief says.`
    await this.agents.send(key, hidden(text, 'github', { task: t.id, pr: String(n) }), { ensure: () => this.launch(t) }).catch(() => undefined)
  }

  /**
   * Rebase the task's branch on main, squash-merge it into main and mark it merged: through its pull request on a
   * GitHub repo gh is logged in to, else here. Its agent and worktree are put away once the agent's turn ends (it may
   * be the one asking). A conflict or failed checks stop it with what to do. Anyone but the task's own agent waits
   * until that agent's turn has ended, so no half-done work goes in.
   */
  merge(id: string, opts: { self?: boolean } = {}): Promise<{ ok: boolean; error?: string; note?: string }> {
    const t = this.req(id)
    if (this.closing)
      return Promise.resolve({ ok: false, error: `Lineclear is restarting: nothing was merged. Run lineclear merge ${t.id} again in a minute.` })
    // asked again while its merge still runs: the same one is waited for, never a second beside it
    let run = this.landings.get(t.id)
    if (!run) {
      const repo = this.places.space(t.project)?.path ?? ''
      const now = (this.merging.get(repo) ?? Promise.resolve())
        .then(() => this.head(t, repo, !!opts.self))
        // stopped short with nothing more to wait for (failed checks, GitHub refused): Ready again, or back at work
        .then(async (r) => {
          if (!r.ok && ['queue', 'check', 'merge'].includes(t.landing?.step ?? '')) this.land(t)
          // what task show says when the caller never heard
          t.mergeStopped = r.ok ? undefined : (r.error ?? 'Merge failed.').slice(0, 300)
          this.save()
          // over before its caller hears: one asking right after starts a merge of its own, never joins this answer
          this.landings.delete(t.id)
          return Lane.tellIfLeft(this.callerLeft.delete(t.id), r, (m) => this.sendBack(t, m))
        })
      run = now
      this.landings.set(t.id, now)
      const tail = now.catch(() => undefined)
      tail.then(() => this.landings.get(t.id) === now && this.landings.delete(t.id))
      // the next merge into this repo waits until this one is really through, however long: two at once would write
      // over each other's main
      this.merging.set(repo, tail)
      tail.then(() => this.merging.get(repo) === tail && this.merging.delete(repo))
    }
    // its caller waits for the end, merged or stopped with a reason, however long git, GitHub or the check line take.
    // Past the deadline it may be gone (its shell moved it to the background): an error is then also sent to the agent
    const late = setTimeout(() => this.landings.has(t.id) && this.callerLeft.add(t.id), this.mergeDeadline)
    return run.finally(() => clearTimeout(late))
  }

  /** a task's merge while it holds its repo's lane: the head, which the lane lets go when it hangs (watchHeads) */
  protected async head(t: TaskRec, repo: string, self: boolean): Promise<{ ok: boolean; error?: string; note?: string }> {
    this.headWatch.begin(
      t.id,
      [t.worktree, repo].filter((d): d is string => !!d),
      Lane.turnLimitMs(repo),
    )
    const run = ++this.runs
    this.runOf.set(t.id, run)
    const freed = new Promise<{ ok: false; error: string; freed: true }>((free) => this.frees.set(t.id, free))
    const work = this.inRun.run(run, () =>
      this.onGitHub(
        () => this.mergeNow(t, self),
        (error) => ({ ok: false, error: `Can't merge ${t.id}: ${error}` }),
      ),
    )
    // a released run is forgotten once it ends
    const ended = () => this.cut.delete(run)
    work.then(ended, ended)
    try {
      const r = await Promise.race([work, freed])
      if (!('freed' in r)) this.released.delete(t.id)
      return r
    } finally {
      this.headWatch.end(t.id)
      this.frees.delete(t.id)
      if (this.runOf.get(t.id) === run) this.runOf.delete(t.id)
    }
  }

  /** A merge cut short by a restart ends as stopped: Ready again, with the reason, never Merging for good. */
  endLostMerges() {
    for (const t of this.tasks.filter((t) => t.landing && !ended(t))) {
      t.mergeStopped = 'Lineclear restarted before its merge was through; nothing was merged, run lineclear merge again.'
      this.land(t)
    }
  }

  /**
   * Lineclear stops (an update restarts it, as one right after a merge into its own repo does): the merges on their
   * way finish first, at most their deadline, so none is cut halfway (merged on GitHub, never marked, its agent never
   * told). A caller whose merge goes on longer asks again; that joins the merge or finds it merged. No new one starts meanwhile. True when there was one to wait for.
   */
  async drain(): Promise<boolean> {
    this.closing = true
    const on = [...this.landings.values()]
    if (!on.length) return false
    await Promise.race([Promise.allSettled(on), Bun.sleep(this.mergeDeadline)])
    return true
  }

  protected mergeNow(t: TaskRec, self: boolean): Promise<{ ok: boolean; error?: string; note?: string }> {
    return this.onMachineOf(t, () => this.mergeOnMachine(t, self))
  }

  private async mergeOnMachine(t: TaskRec, self: boolean): Promise<{ ok: boolean; error?: string; note?: string }> {
    // asked again after its first answer was lost: the merge is the answer
    if (t.merged) return { ok: true, note: `${t.id} is merged already` }
    if (t.closed) return { ok: false, error: `${t.id} is Done: it had nothing to merge` }
    if (!t.worktree || !t.branch || !t.base) return { ok: false, error: `${t.id} has no branch yet` }
    if (!self && this.agents.status(this.key(t)) === 'working')
      return { ok: false, error: `${t.id}'s agent is working: wait for its turn to end, or ask it to merge (lineclear task tell ${t.id} "merge it").` }
    // a late note from you or a coordinator, not read yet, may change what goes in
    if (this.chats.unseen(this.key(t)).length)
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
    this.land(t, 'merge')
    const p = this.proj(t)
    const wt = t.worktree
    // a folder removed under the merge (a temp dir cleaned away) would only show as a git that "can't be found"
    const gone = [p.path, wt].find((d) => !existsSync(d))
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
    const gated =
      (await this.lane(t, p, self)) ??
      (await Lane.smokeGate(t.worktree, t.base, async (m) => {
        this.land(t)
        return this.sendBackOrTell(t, self, m.replace('{id}', t.id))
      }))
    if (gated) return gated
    const g = await this.hub(p)
    if (g) return this.mergeOnGitHub(t, p, g, self)
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
      const message = `${t.id}: ${t.title}${t.said ? `\n\n${t.said}` : ''}${t.facts ? `\n\nFacts: ${t.facts}` : ''}`
      const m = await G.mergeHere(p.path, t.branch, t.base, message, true)
      if (!m.ok) {
        if (/conflict/i.test(`${m.out}${m.err}`)) this.land(t, 'rebase')
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
    return this.markMerged(t, note)
  }

  /** an error for the caller; anyone but the task's own agent also sends it to the agent */
  protected async sendBackOrTell(t: TaskRec, self: boolean, error: string) {
    if (self && !this.callerLeft.has(t.id)) return { ok: false as const, error }
    await this.sendBack(t, error)
    return { ok: false as const, error: `${error} Sent back to ${t.id}'s agent to fix.` }
  }

  /** a conflict with main goes back to the task's agent with the files that clash */
  protected async conflict(t: TaskRec, self: boolean, files: string[]) {
    this.land(t, 'rebase')
    return this.sendBackOrTell(
      t,
      self,
      `Conflict with ${t.base}: rebase ${t.branch} on ${t.base} by hand, commit, then run lineclear merge ${t.id} again. Conflicting files: ${files.join(', ')}.`,
    )
  }

  /**
   * The merge lane's rule, the same for every merge: the branch is rebased on main and the project's full check runs on
   * that merged result, once (workers run only the check of what they changed). A conflict or a failed check goes back
   * to the task's agent with the files or the output. Undefined means it may go in.
   */
  protected async lane(t: TaskRec, p: Space, self: boolean): Promise<{ ok: false; error: string } | undefined> {
    const [wt, base] = [t.worktree!, t.base!]
    if ((await G.aheadCount(wt, base)) === 0 || (await G.landed(wt, 'HEAD', base))) return undefined
    const command = Lane.projectCheck(p.path)
    // the full check runs on GitHub, on the pull request (mergeOnGitHub waits for it): nothing runs here
    if (this.settings.ways(p.name).checkWhere === 'github') {
      if (await this.hub(p)) return undefined
      return {
        ok: false,
        error: `Setting Full check runs is github, but ${p.name} has no GitHub remote gh can use here (gh auth login). Nothing was merged.`,
      }
    }
    // no check set for the project: nothing is assumed about its tools, and the merge goes on as before
    if (!command) return undefined
    // a red main or a check the machine failed pauses the line; the task that fixes it goes first
    const repo = this.places.space(t.project)?.path ?? p.path
    const paused = /^fix\b/i.test(t.title) ? undefined : Runs.lanePause(Runs.readRuns(repo, Date.now() - 86_400_000), base)
    if (paused) return { ok: false, error: `The merge line is paused: ${paused}. Nothing was merged. Run lineclear merge ${t.id} again in a few minutes.` }
    // one full check at a time in this repo; a real change by the task (not a message) makes it leave the line
    const c = await Lane.checkInTurn(t.id, repo, wt, base, command, {
      slotMachine: t.machine,
      gone: () => (!t.landing ? 'its merge was cancelled' : ended(t) ? 'it is ended' : this.task(t.id) !== t ? 'its record was replaced' : undefined),
      waiting: (n, noSlot) => t.landing && this.land(t, n || noSlot ? 'queue' : 'check', undefined, n),
    })
    if (c.step === 'conflict') return this.conflict(t, self, (await Lane.conflictFiles(wt, base)) ?? (await Lane.sharedFiles(wt, base)))
    // back at work before its turn (its branch not touched), or while the check ran (its edits kept, rebased on main)
    if (c.step === 'left' && t.landing) this.land(t)
    if (c.step === 'left' || !t.landing)
      return {
        ok: false,
        error: `${t.id} went back to work while its merge waited for the check slot (${c.step === 'left' ? c.why : 'its merge was cancelled'}), so nothing was merged: run lineclear merge ${t.id} again when it is ready.`,
      }
    this.land(t, 'merge')
    if (!c.ok) {
      // back where it was, so the next merge rebases and checks again
      await G.git(wt, 'reset', '--hard', c.before)
      this.land(t)
      return this.sendBackOrTell(
        t,
        self,
        `the full check (${command}) ran on ${t.branch} rebased on ${base}, and it failed:\n${c.tail}\nRebase on ${base}, fix it, commit, then run lineclear merge ${t.id} again.`,
      )
    }
    // a check that rewrote tracked files (a formatter, a lockfile) must not make the rebase that follows refuse
    await G.git(wt, 'reset', '--hard', 'HEAD')
    return undefined
  }

  /**
   * Through the pull request, as herdr-projects lands one: the branch pushed as it is, rebased on GitHub's main only
   * when it conflicts with it (its pull request opened if the agent didn't), GitHub's checks passed at exactly that
   * commit, then squash-merged on GitHub only while its head is still that commit, its branch there deleted, and main here brought up to GitHub's (which
   * is what Lineclear's own update watches). Failed checks go back to the agent.
   */
  protected async mergeOnGitHub(t: TaskRec, p: Space, g: G.GitHub, self: boolean): Promise<{ ok: boolean; error?: string; note?: string }> {
    const wt = t.worktree!
    const base = `origin/${t.base}`
    if (!(await G.git(p.path, 'rev-parse', '--verify', '--quiet', base)).ok)
      return { ok: false, error: `GitHub has no ${t.base} yet: push it once (git push origin ${t.base}), then merge again.` }
    // main here holds commits GitHub lacks: merging on GitHub would split the two, so they go up first, by you
    const ahead = Number((await G.git(p.path, 'rev-list', '--count', `${base}..${t.base}`)).out || 0)
    if (ahead)
      return {
        ok: false,
        error: `${t.base} here has ${ahead} commit${ahead === 1 ? '' : 's'} GitHub lacks: push ${t.base} (git push origin ${t.base}) or move them off it, then merge ${t.id} again. Nothing was merged.`,
      }
    const pr = await this.prOf(t, g, wt)
    if (pr && pr.baseRefName !== t.base)
      return {
        ok: false,
        error: `PR #${pr.number} targets ${pr.baseRefName}, but ${t.id} targets ${t.base}. Correct the pull request target on GitHub first. Nothing was merged.`,
      }
    // merged on GitHub already (by hand, or a merge whose answer was lost): it only needs main here and marking
    if (pr?.state === 'MERGED') return this.mergedOnGitHub(t, p, `PR #${pr.number} was merged on GitHub already`)
    if ((await G.aheadCount(wt, t.base!)) === 0) return { ok: false, error: `${t.id} has no changes to merge` }
    // GitHub squash-merges a branch behind main as it is: rebasing it would make a new commit, and all its checks run
    // again (again each time main moves meanwhile). Only a real conflict is rebased here; a clash that merges cleanly
    // but breaks is caught by the checks on main.
    let rebased = false
    if (!(await G.mergesCleanly(wt, base, 'HEAD'))) {
      const rb = await G.rebase(wt, base)
      if (!rb.ok) return this.conflict(t, self, (await Lane.conflictFiles(wt, base)) ?? (await Lane.sharedFiles(wt, base)))
      rebased = true
    }
    // main has this work already (merged another way): its pull request would change nothing
    if (await G.landed(wt, 'HEAD', base)) {
      // closed, with its branch there
      const closed = pr ? (await GH.closePr(g, wt, pr.number, `Closed by Lineclear: ${t.base} has this work already.`)).ok : false
      if (closed) await G.git(p.path, 'push', '--quiet', 'origin', '--delete', t.branch!)
      return this.mergedOnGitHub(
        t,
        p,
        `it was in ${t.base} already${pr ? (closed ? `; closed PR #${pr.number}` : `; could not close PR #${pr.number}: close it on GitHub`) : ''}`,
      )
    }
    const head = (await G.git(wt, 'rev-parse', 'HEAD')).out
    const pushing = !pr || pr.headRefOid !== head
    if (pushing) {
      const push = await this.push(t)
      if (!push.ok) return { ok: false, error: `Could not push ${t.branch} to GitHub: ${(push.err || push.out).split('\n')[0]}` }
    }
    if (!pr) {
      const o = await GH.openPr(g, wt, { branch: t.branch!, base: t.base!, title: t.title, body: this.prBody(t), draft: false })
      if ('error' in o) return { ok: false, error: `GitHub did not open a pull request for ${t.branch}: ${o.error}` }
      t.pr = { number: o.number, url: o.url }
      this.save()
    } else {
      // its words carry the summary, whether or not the agent reported done before
      if (t.said) await GH.editPr(g, wt, pr.number, this.prBody(t))
      if (pr.isDraft) await GH.readyPr(g, wt, pr.number)
    }
    const n = t.pr!.number
    const ways = this.settings.ways(p.name)
    const wait = ways.checkWhere === 'github' || (t.waitChecks ?? ways.waitChecks)
    // not waited for (Settings): its own quick checks passed, and GitHub's run on, here and then on main
    // (watchMain); only a failure GitHub already shows at this very commit stops it
    const now = wait || pushing ? undefined : await GH.prChecks(g, wt, n)
    const c = wait ? await this.checksOf(t, g, n, 0) : now?.state === 'fail' ? now : { state: 'pass' as const, passed: 0, failed: [] }
    if (c.state === 'pending') {
      this.land(t, 'checks', await this.checksDue(t, p, g, head))
      return {
        ok: false,
        error: `GitHub's checks are running on PR #${n}${pushing ? ` (just pushed${rebased ? `, rebased on ${t.base} for a conflict` : ''})` : ''}: wait for them with lineclear checks ${t.id}, then run lineclear merge ${t.id} again.`,
      }
    }
    if (c.state === 'error') return { ok: false, error: `Could not read GitHub's checks on PR #${n}: ${c.error}. Nothing was merged.` }
    if (c.state === 'fail') {
      const why = this.checksFailed(n, c)
      if (self) {
        this.toldFailed(t, head, c)
        return { ok: false, error: `${why} ${this.fixIt(t)}` }
      }
      this.toldFailed(t, head, c)
      await this.sendBack(t, `${why} ${this.fixIt(t)}`)
      return { ok: false, error: `${why} Sent back to ${t.id}'s agent to fix.` }
    }
    const m = await GH.mergePr(g, wt, n, head, `${t.id}: ${t.title} (#${n})`, [t.said, t.facts && `Facts: ${t.facts}`].filter(Boolean).join('\n\n'))
    let state = (await GH.viewPr(g, wt, n))?.state
    // a repo with a merge queue only queues the pull request: GitHub's full check runs there and merges it when green
    if (state !== 'MERGED' && /merge queue|automatically merged|auto-merge/i.test(`${m.out}\n${m.err}`)) {
      for (const t0 = Date.now(); state === 'OPEN' && Date.now() - t0 < QUEUE_WAIT_MS; ) {
        await Bun.sleep(CHECKS_EVERY)
        state = (await GH.viewPr(g, wt, n))?.state
      }
    }
    if (state !== 'MERGED') {
      const said = (m.err || m.out || 'it did not say why').split('\n')[0]
      // main moved on GitHub since it was fetched: merging again rebases it if it now conflicts (Merging meanwhile)
      if (/conflict|not mergeable/i.test(said)) this.land(t, 'rebase')
      return {
        ok: false,
        error: /conflict|not mergeable/i.test(said)
          ? `Conflict with ${t.base} on GitHub: run lineclear merge ${t.id} again, which rebases ${t.branch} on ${base} (or rebase it by hand, push with lineclear pr ${t.id}, then merge again).`
          : `GitHub did not merge PR #${n}: ${said}`,
      }
    }
    await G.git(p.path, 'push', '--quiet', 'origin', '--delete', t.branch!)
    return this.mergedOnGitHub(t, p, `merged PR #${n} on GitHub${wait ? '' : ', not waiting for its checks'}`)
  }

  /** main here comes up to GitHub's, so the merge is here too (and Lineclear's own update sees it), then it is marked */
  protected async mergedOnGitHub(t: TaskRec, p: Space, note: string) {
    const up = await G.catchUp(p.path, t.base!)
    return this.markMerged(t, up.ok ? note : `${note}; ${t.base} here is not up to date: ${up.err}`)
  }

  protected async markMerged(t: TaskRec, note?: string) {
    t.merged = true
    t.doneAt = Date.now()
    t.reported = true
    t.landing = undefined
    t.trouble = undefined
    t.stopped = undefined
    this.settle(t)
    this.emit('gone', t, true)
    this.dropEndedOutbox()
    if (this.agents.status(this.key(t)) !== 'working') await this.cleanup(t)
    return { ok: true, note }
  }

  /** what its agent must fix, written to it: it is at work again */
  protected async sendBack(t: TaskRec, text: string) {
    await this.agents.send(this.key(t), text, { ensure: () => this.launch(t) }).catch(() => undefined)
    this.youWrote(this.key(t))
  }

  /** a message sent to a task agent asks something of it: it is working again, not done. `go`: false for an answer in
   *  its CLI's own menu or question, which is no go for a queued task */
  youWrote(key: string, { go = true } = {}) {
    const [id] = key.split('/')
    const t = this.task(id)
    if (!t) return
    // writing to an archived task brings it back: you talk to it again
    if (t.archived) this.unarchive(t.id)
    if (ended(t)) return
    // a merge waiting for the check slot or running its check is cancelled only by a real change (HEAD moved, worktree
    // dirty: the lane checks), never by words: nudges and notes reach the task while it waits
    if (t.landing && (t.landing.step === 'queue' || t.landing.step === 'check')) return
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
    this.wrote.set(t.id, Date.now())
    this.settle(t)
    this.settleSoon(t, ANSWER_GRACE + 500)
  }
}
