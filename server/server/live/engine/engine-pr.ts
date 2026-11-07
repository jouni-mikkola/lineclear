import type { Engine } from './engine.ts'
import type { Space } from '../places.ts'
import { splitBrief } from '../settings-block.ts'
import * as G from './git.ts'
import * as GH from './github.ts'
import * as News from './github-news.ts'
import { type TaskRec, ended, CHECKS_EVERY, CHECKS_SHOW, LATER, failKey, ghNow } from './engine-helpers.ts'
import type * as Lane from './lane.ts'

/** a task's pull request on GitHub: opening it, its words and GitHub's checks */
export class EnginePr {
  constructor(private readonly e: Engine) {}

  /** GitHub's word on each repo, read once for all its tasks (watching them, waiting for their checks) */

  /**
   * The project's GitHub repo when gh is logged in to its host, read live: a repo may gain its remote after it was
   * added. Each form of origin is tried (as git rewrites it, as written) for one gh is logged in to. None: the task
   * merges here. Logged in but GitHub not answering throws: that never falls back to merging here.
   */
  async hub(p: Space): Promise<GH.GitHub | null> {
    const was = p.github
    await this.e.places.recheckGithub(p)
    if (p.github !== was) this.e.emit('changed')
    let down: string | undefined
    for (const g of await GH.githubs(p.path)) {
      const l = await GH.ghLogin(g, p.path)
      if (l.state === 'yes') return g
      if (l.state === 'down') down ??= `${g.host}: ${l.said}`
    }
    if (down) throw new Error(`gh can't reach GitHub now (${down}). Nothing was done: try again in a while, or see gh auth status.`)
    return null
  }

  /**
   * The pull request's words: what changed (the agent's summary), why (the brief's first paragraph, without the
   * Settings block Lineclear adds) and the proof (the facts line, one bullet per fact).
   */
  prBody(t: TaskRec) {
    if (!t.said) return 'Work in progress: the summary comes when the task is done.'
    const why = splitBrief(t.desc ?? '')[0]
      .replace(LATER, '')
      .trim()
      .split(/\n\s*\n/)[0]
    const proof = (t.facts ?? '')
      .split(' · ')
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => `- ${f}`)
    return [`## What\n${t.said}`, why && `## Why\n${why}`, proof.length && `## Proof\n${proof.join('\n')}`].filter(Boolean).join('\n\n')
  }

  /** its pull request as GitHub has it now: the one recorded, else the branch's own (one opened by hand) */
  async prOf(t: TaskRec, g: GH.GitHub, cwd: string) {
    const known = t.pr ? await GH.viewPr(g, cwd, t.pr.number) : null
    // one closed on GitHub is no longer its pull request: the branch may have another
    const pr = known && known.state !== 'CLOSED' ? known : await GH.findPr(g, cwd, t.branch!)
    if ((pr?.number ?? null) !== (t.pr?.number ?? null) && (pr || known?.state === 'CLOSED')) {
      t.pr = pr ? { number: pr.number, url: pr.url } : undefined
      this.e.save()
    }
    return pr
  }

  async readyForReview(t: TaskRec, hub?: GH.GitHub) {
    const p = this.e.proj(t)
    const g = hub ?? (await this.hub(p))
    if (!g || !t.pr) return
    await GH.editPr(g, p.path, t.pr.number, this.prBody(t))
    await GH.readyPr(g, p.path, t.pr.number)
  }

  /** push the task's branch as it is committed, to GitHub: forced, since it is rebased on main and only its agent's */
  async push(t: TaskRec) {
    const sha = (await G.git(t.worktree!, 'rev-parse', 'HEAD')).out
    const r = await G.git(t.worktree!, 'push', '--quiet', '--force', 'origin', `HEAD:refs/heads/${t.branch}`)
    if (r.ok) {
      t.pushed = { sha, at: Date.now() }
      this.e.save()
    }
    return r
  }

  /** a GitHub step that could not reach GitHub says so, and did nothing */
  async onGitHub<T extends { ok: boolean }>(f: () => Promise<T>, failed: (why: string) => T): Promise<T> {
    try {
      return await f()
    } catch (e) {
      return failed((e as Error).message)
    }
  }

  /**
   * lineclear pr: push the branch and open its pull request (a draft until the agent reports done), or bring the open
   * one up to the branch. Its title is the task's, its words the summary.
   */
  openPr(id: string): Promise<{ ok: boolean; text: string }> {
    return this.onGitHub(
      () => this.openPrNow(this.e.req(id)),
      (text) => ({ ok: false, text }),
    )
  }

  async openPrNow(t: TaskRec): Promise<{ ok: boolean; text: string }> {
    if (ended(t)) return { ok: false, text: `${t.id} is Done already (${t.closed ? 'nothing to merge' : 'merged'}).` }
    if (!t.worktree || !t.branch || !t.base) return { ok: false, text: `${t.id} has no branch yet.` }
    const p = this.e.proj(t)
    const g = await this.hub(p)
    if (!g)
      return {
        ok: true,
        text: `No pull request: ${p.name} has no GitHub remote, or gh isn't logged in to it (gh auth status). lineclear merge ${t.id} squash-merges it here.`,
      }
    if ((await G.aheadCount(t.worktree, t.base)) === 0)
      return { ok: false, text: `${t.id} has no commits yet: commit your work, then run lineclear pr ${t.id} again.` }
    const dirty = await G.dirty(t.worktree)
    const pushed = await this.e.push(t)
    if (!pushed.ok) return { ok: false, text: `Could not push ${t.branch} to GitHub: ${(pushed.err || pushed.out).split('\n')[0]}` }
    const pr = await this.prOf(t, g, t.worktree)
    if (pr && pr.baseRefName !== t.base)
      return { ok: false, text: `PR #${pr.number} targets ${pr.baseRefName}, but ${t.id} targets ${t.base}. Correct the pull request target on GitHub first.` }
    let opened = false
    if (pr?.state === 'MERGED')
      return { ok: false, text: `PR #${pr.number} is merged on GitHub already: run lineclear merge ${t.id} to mark it merged and clean up.` }
    if (!pr) {
      const o = await GH.openPr(g, t.worktree, { branch: t.branch, base: t.base, title: t.title, body: this.prBody(t), draft: !t.reported })
      if ('error' in o) return { ok: false, text: `Pushed ${t.branch}, but GitHub did not open a pull request: ${o.error}` }
      t.pr = { number: o.number, url: o.url }
      this.e.save()
      opened = true
    } else if (t.reported) await this.readyForReview(t, g)
    const head = (await G.git(t.worktree, 'rev-parse', '--short', 'HEAD')).out
    return {
      ok: true,
      text: `${opened ? `Opened PR #${t.pr!.number}${t.reported ? '' : ' as a draft'}` : `Pushed to PR #${t.pr!.number}`} at ${head}: ${t.pr!.url}${dirty ? '\nUncommitted changes are not in it: commit them and run lineclear pr again.' : ''}\n${(t.waitChecks ?? this.e.settings.ways(p.name).waitChecks) ? `Next: lineclear checks ${t.id} waits for GitHub's checks (run it with a long timeout, up to 10 minutes).` : `Merging doesn't wait for GitHub's checks (lineclear checks ${t.id} waits for any that run on it, if you want to see them).`}`,
    }
  }

  /**
   * GitHub's checks on the task's pull request, waited for while they run (up to `waitMs`). A commit Lineclear just
   * pushed, in a repo with workflows that run on pull requests, shows none for a moment: that moment is waited out, never taken as passed (after
   * it, none is none: the repo's workflows may not run on pull requests). GitHub not answering three times running
   * is said, not waited on.
   */
  async checksOf(t: TaskRec, g: GH.GitHub, n: number, waitMs: number): Promise<GH.PrChecks> {
    const t0 = Date.now()
    const head = (await G.git(t.worktree!, 'rev-parse', 'HEAD')).out
    const expect = await GH.hasPrWorkflows(t.worktree!)
    let errors = 0
    let first = true
    for (;;) {
      // the first look is of GitHub as it is now; waiting after it shares the repo's reads
      const c = await this.sharedChecks(g, t.worktree!, n, head, first ? 0 : CHECKS_EVERY / 2)
      first = false
      errors = c.state === 'error' ? errors + 1 : 0
      const early = c.state === 'none' && expect && t.pushed?.sha === head && Date.now() - t.pushed.at < CHECKS_SHOW
      if ((c.state !== 'pending' && c.state !== 'error' && !early) || errors >= 3) return this.withTests(g, t.worktree!, c)
      if (Date.now() - t0 + CHECKS_EVERY > waitMs) return early ? { ...c, state: 'pending' } : this.withTests(g, t.worktree!, c)
      await Bun.sleep(CHECKS_EVERY)
    }
  }

  /** the checks as the repo's one read has them; asked of gh for this pull request alone when that read can't tell */
  private async sharedChecks(g: GH.GitHub, cwd: string, n: number, head: string, maxAge: number) {
    try {
      const shared = await this.e.repos.checks(g, cwd, n, head, maxAge)
      if (shared) return shared
    } catch (e) {
      if (!(e instanceof GH.GhDown)) throw e
    }
    return GH.prChecks(g, cwd, n)
  }

  /** failed checks with the names of the tests their job logs show as failed */
  private async withTests(g: GH.GitHub, cwd: string, c: GH.PrChecks): Promise<GH.PrChecks> {
    if (c.state !== 'fail') return c
    const failed = await Promise.all(c.failed.map(async (f) => (f.link ? { ...f, tests: await News.failedTestNames(g, cwd, f.link) } : f)))
    return { ...c, failed }
  }

  /** a ready task's next step into main (Merging), or none: Ready again, or back at work */
  land(t: TaskRec, step?: Lane.Landing['step'], due?: number) {
    // a merge the lane released goes no further
    if (step && G.stepSignal.getStore()?.aborted) throw new Error(`${t.id}'s merge was released by the lane`)
    if (!t.reported || ended(t)) return
    t.landing = step ? { step, at: Date.now(), due } : undefined
    this.e.save()
    this.e.settle(t)
  }

  /** when GitHub's checks at `head` should be through: from when it was pushed, as long as they took lately */
  async checksDue(t: TaskRec, p: Space, g: GH.GitHub, head: string) {
    let took = this.e.took.get(p.path)
    if (!took || Date.now() - took.at > 30 * 60_000) {
      took = { ms: await GH.checksTook(g, p.path).catch(() => undefined), at: Date.now() }
      this.e.took.set(p.path, took)
    }
    if (took.ms === undefined) return undefined
    return (t.pushed?.sha === head ? t.pushed.at : Date.now()) + took.ms
  }

  /** which of GitHub's checks failed, and where to see why */
  checksFailed(n: number, c: GH.PrChecks) {
    const link = c.failed.find((f) => f.link)?.link
    const tests = [...new Set(c.failed.flatMap((f) => f.tests ?? []))]
    return `GitHub's checks failed on PR #${n}: ${c.failed.map((f) => f.name).join(', ')}.${tests.length ? ` Failing tests: ${tests.join(', ')}.` : ''}${link ? ` See ${link} (gh run view --log-failed shows why).` : ''}`
  }

  fixIt(t: TaskRec) {
    return `Fix it, commit, push with lineclear pr ${t.id}, wait with lineclear checks ${t.id}, then run lineclear merge ${t.id} again.`
  }

  async checksNow(t: TaskRec, waitMs: number): Promise<{ ok: boolean; text: string }> {
    if (!t.worktree || !t.branch) return { ok: false, text: `${t.id} has no branch yet.` }
    const p = this.e.proj(t)
    const g = await this.hub(p)
    if (!g) return { ok: true, text: `No GitHub checks: ${p.name} has no GitHub remote, or gh isn't logged in to it. Run the project's own checks here.` }
    const pr = await this.prOf(t, g, t.worktree)
    if (!pr) return { ok: false, text: `${t.id} has no pull request yet: lineclear pr ${t.id} pushes the branch and opens one.` }
    const head = (await G.git(t.worktree, 'rev-parse', 'HEAD')).out
    if (pr.headRefOid !== head)
      return { ok: false, text: `PR #${pr.number} is not at your commit (${head.slice(0, 7)}): push it with lineclear pr ${t.id} first.` }
    // on its way into main (a merge waits for them): the row says they run, then what comes next
    if (t.landing) this.land(t, 'checks', await this.checksDue(t, p, g, head))
    const c = await this.checksOf(t, g, pr.number, waitMs)
    if (t.landing && c.state !== 'pending') this.land(t, c.state === 'pass' || c.state === 'none' ? 'merge' : undefined)
    if (c.state === 'fail') {
      this.toldFailed(t, head, c)
      return { ok: false, text: `${this.checksFailed(pr.number, c)} ${this.fixIt(t)}` }
    }
    if (c.state === 'pending') return { ok: false, text: `GitHub's checks still run on PR #${pr.number}: run lineclear checks ${t.id} again.` }
    if (c.state === 'error') return { ok: false, text: `Could not read GitHub's checks on PR #${pr.number}: ${c.error}` }
    return {
      ok: true,
      text: c.state === 'none' ? `PR #${pr.number} has no checks on GitHub: nothing to wait for.` : `GitHub's checks passed on PR #${pr.number} (${c.passed}).`,
    }
  }

  /** checks that failed at a commit were told to the agent (lineclear checks, merge): watching won't tell it again */
  toldFailed(t: TaskRec, head: string, c: GH.PrChecks) {
    t.watch = { ...t.watch, since: t.watch?.since ?? ghNow(), failed: failKey(head, c) }
    this.e.save()
  }
}
