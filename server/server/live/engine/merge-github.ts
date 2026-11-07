import type { Engine } from './engine.ts'
import type { Space } from '../places.ts'
import * as G from './git.ts'
import * as GH from './github.ts'
import * as Lane from './lane.ts'
import type { TaskRec } from './engine-helpers.ts'

/** a task's merge through its pull request on GitHub, and what comes after */
export class EngineMergeGitHub {
  constructor(private readonly e: Engine) {}

  /**
   * Through the pull request, as herdr-projects lands one: the branch pushed as it is, rebased on GitHub's main only
   * when it conflicts with it (its pull request opened if the agent didn't), GitHub's checks passed at exactly that
   * commit, then squash-merged on GitHub only while its head is still that commit, its branch there deleted, and main here brought up to GitHub's (which
   * is what Lineclear's own update watches). Failed checks go back to the agent.
   */
  async mergeOnGitHub(t: TaskRec, p: Space, g: GH.GitHub, self: boolean): Promise<{ ok: boolean; error?: string; note?: string }> {
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
    const pr = await this.e.prPart.prOf(t, g, wt)
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
      if (!rb.ok) return this.e.landPart.conflict(t, self, (await Lane.conflictFiles(wt, base)) ?? (await Lane.sharedFiles(wt, base)))
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
    const held = await this.e.landPart.holdWhileRed(t)
    if (held) return { ok: false, error: held }
    const head = (await G.git(wt, 'rev-parse', 'HEAD')).out
    const pushing = !pr || pr.headRefOid !== head
    if (pushing) {
      const push = await this.e.push(t)
      if (!push.ok) return { ok: false, error: `Could not push ${t.branch} to GitHub: ${(push.err || push.out).split('\n')[0]}` }
    }
    if (!pr) {
      const o = await GH.openPr(g, wt, { branch: t.branch!, base: t.base!, title: t.title, body: this.e.prPart.prBody(t), draft: false })
      if ('error' in o) return { ok: false, error: `GitHub did not open a pull request for ${t.branch}: ${o.error}` }
      t.pr = { number: o.number, url: o.url }
      this.e.save()
    } else {
      // its words carry the summary, whether or not the agent reported done before
      if (t.said) await GH.editPr(g, wt, pr.number, this.e.prPart.prBody(t))
      if (pr.isDraft) await GH.readyPr(g, wt, pr.number)
    }
    const n = t.pr!.number
    const wait = t.waitChecks ?? this.e.settings.ways(p.name).waitChecks
    // not waited for (Settings): its own quick checks passed, and GitHub's run on, here and then on main
    // (watchMain); only a failure GitHub already shows at this very commit stops it
    const now = wait || pushing ? undefined : await GH.prChecks(g, wt, n)
    const c = wait ? await this.e.prPart.checksOf(t, g, n, 0) : now?.state === 'fail' ? now : { state: 'pass' as const, passed: 0, failed: [] }
    if (c.state === 'pending') {
      this.e.prPart.land(t, 'checks', await this.e.prPart.checksDue(t, p, g, head))
      return {
        ok: false,
        error: `GitHub's checks are running on PR #${n}${pushing ? ` (just pushed${rebased ? `, rebased on ${t.base} for a conflict` : ''})` : ''}: wait for them with lineclear checks ${t.id}, then run lineclear merge ${t.id} again.`,
      }
    }
    if (c.state === 'error') return { ok: false, error: `Could not read GitHub's checks on PR #${n}: ${c.error}. Nothing was merged.` }
    if (c.state === 'fail') {
      const why = this.e.prPart.checksFailed(n, c)
      if (self) {
        this.e.prPart.toldFailed(t, head, c)
        return { ok: false, error: `${why} ${this.e.prPart.fixIt(t)}` }
      }
      this.e.prPart.toldFailed(t, head, c)
      await this.sendBack(t, `${why} ${this.e.prPart.fixIt(t)}`)
      return { ok: false, error: `${why} Sent back to ${t.id}'s agent to fix.` }
    }
    const m = await GH.mergePr(g, wt, n, head, `${t.id}: ${t.title} (#${n})`, t.said ?? '')
    const state = (await GH.viewPr(g, wt, n))?.state
    // a repo with a merge queue only queues the pull request: GitHub's full check runs there and merges it when green.
    // The line is not held for that: the board asks again and finds it merged.
    if (state === 'OPEN' && /merge queue|automatically merged|auto-merge/i.test(`${m.out}\n${m.err}`))
      return {
        ok: false,
        error: `PR #${n} is in GitHub's merge queue: it merges there once its check is green. ${t.id} is marked merged on the next lineclear merge ${t.id}.`,
      }
    if (state !== 'MERGED') {
      const said = (m.err || m.out || 'it did not say why').split('\n')[0]
      // main moved on GitHub since it was fetched: merging again rebases it if it now conflicts (Merging meanwhile)
      if (/conflict|not mergeable/i.test(said)) this.e.prPart.land(t, 'rebase')
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
  async mergedOnGitHub(t: TaskRec, p: Space, note: string) {
    const up = await G.catchUp(p.path, t.base!)
    return this.markMerged(t, up.ok ? note : `${note}; ${t.base} here is not up to date: ${up.err}`)
  }

  async markMerged(t: TaskRec, note?: string) {
    t.merged = true
    t.doneAt = Date.now()
    t.reported = true
    t.landing = undefined
    t.trouble = undefined
    t.stopped = undefined
    this.e.settle(t)
    this.e.handoffPart.dropEndedOutbox()
    if (this.e.agents.status(this.e.key(t)) !== 'working') await this.e.handoffPart.cleanup(t)
    return { ok: true, note }
  }

  /** what its agent must fix, written to it: it is at work again */
  async sendBack(t: TaskRec, text: string) {
    await this.e.agents.send(this.e.key(t), text, { ensure: () => this.e.launch(t) }).catch(() => undefined)
    this.e.youWrote(this.e.key(t))
  }
}
