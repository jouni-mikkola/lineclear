import { existsSync } from '../mfs.ts'
import type { Question } from '../../../shared/types.ts'
import { hidden } from '../agents.ts'
import type { Space } from '../places.ts'
import { restartLine, resumedLine, splitBrief, taskFirst } from '../prompts.ts'
import { CLI_NAME } from '../settings.ts'
import { fitHarness, harnessWords, recentChat } from '../restart.ts'
import * as G from './git.ts'
import * as GH from './github.ts'
import { unmerged } from './branch-work.ts'
import * as Lane from './lane.ts'
import { fitStatus } from './status-line.ts'
import { type TaskRec, type Harness, ended, labelOf, CHECKS_EVERY, CHECKS_SHOW, LATER, failKey, ghNow } from './engine-helpers.ts'
import { EngineLaunch } from './engine-launch.ts'

export class EngineHandoff extends EngineLaunch {
  /** writing to a task whose agent stopped starts it again, with its memory */
  resume(id: string) {
    const t = this.task(id)
    if (t?.stuck && !t.worktree && !ended(t)) {
      this.startTask(t).catch((e) => this.troubled(t, e))
      return Promise.resolve(null)
    }
    if (!t?.worktree) return Promise.resolve(null)
    return this.launch(t)
  }

  /**
   * Its agent started again on this CLI, model and effort (the restart sheet, lineclear restart). Mid-turn it is
   * interrupted first. The same CLI resumes its session; another takes over with the brief, the branch's commits,
   * what lies uncommitted and the chat's last messages. What you sent meanwhile waits for it; its worktree and branch
   * stay as they are; a card in its chat marks it.
   */
  async restart(id: string, to: Harness) {
    const t = this.req(id)
    if (ended(t)) throw new Error(this.overWords(t))
    if (!t.worktree) throw new Error(`${t.id} hasn't started yet: it starts on what its brief says.`)
    if (this.handing.has(t.id)) throw new Error(`${t.id}'s agent is starting again already.`)
    if (!this.installed(to.kind)) throw new Error(`${CLI_NAME[to.kind] ?? to.kind} isn't installed on this machine.`)
    const key = this.key(t)
    const h = fitHarness(to)
    const from = this.agents.record(key)?.kind ?? t.agent?.kind ?? ''
    const name = (k: string) => CLI_NAME[k] ?? k
    const words = harnessWords(h)
    this.handing.add(t.id)
    try {
      // what it is told, read once its turn has stopped: what it did meanwhile counts
      const first = async () => {
        await this.agents.stopTurn(key)
        if (from === h.kind) return hidden(resumedLine(words), 'restart')
        return hidden(`${taskFirst(t)}\n\n${restartLine({ from: name(from), to: words, ...(await this.soFar(t, key, name(from))) })}`, 'restart')
      }
      await this.launch(t, undefined, undefined, { ...h, model: h.model ?? '', effort: h.effort ?? '' }, first)
      // a pause or a stop is over: it carries on
      t.stopped = undefined
      t.paused = undefined
      t.agent = h
      const card = `restart:${t.id}:${Date.now()}`
      this.chats.post(key, { id: card, card: { id: card, restart: true, text: `Restarted on ${words}` } })
    } finally {
      this.handing.delete(t.id)
      this.save()
      this.settle(t)
    }
    return words
  }

  /** something went in to an agent: its brief, maybe, which it may already be at work on */
  sent(key: string) {
    const t = this.task(key.split('/')[0])
    if (!t || !this.briefing.has(t.id)) return
    this.begun(t)
    this.settle(t)
  }

  /** what a backup agent is told was done: the branch's commits, what lies uncommitted, the chat's last messages */
  protected async soFar(t: TaskRec, key: string, them: string) {
    const out = async (...args: string[]) => {
      const r = await G.git(t.worktree!, ...args)
      return r.ok ? r.out.split('\n').filter(Boolean).slice(0, 20).join('\n') : ''
    }
    return {
      commits: await out('log', '--oneline', `${t.base}..HEAD`),
      changes: await out('status', '--short'),
      chat: recentChat(this.chats.chat(key).messages, them, taskFirst(t).trim()),
    }
  }

  /* ---------- what agents report ---------- */

  /** the agent's plan: a card in its chat; your answer goes back to it as a chat line */
  async plan(id: string, steps: string[]) {
    const t = this.req(id)
    t.plan = steps
    const q: Question = {
      id: `plan:${t.id}:${Date.now()}`,
      title: `Plan for ${t.id}`,
      kind: 'Plan',
      steps,
      choices: [{ label: 'Approve the plan' }, { label: 'Send it back with a note' }],
      noteRequiredFor: 1,
      to: `${t.id} agent`,
    }
    this.chats.post(this.key(t), { id: q.id, question: q })
    this.save()
  }

  /** the agent's own progress (lineclear status): its line, how far through the task, the minutes left if it said */
  report(id: string, msg: string, progress: number, left?: number) {
    const t = this.req(id)
    if (ended(t)) throw new Error(`${t.id} is Done already (${t.closed ? 'nothing to merge' : 'merged'})`)
    // reported done: nothing shows, and a line kept now would come back stale once it works again
    if (t.reported) throw new Error(`${t.id} is Ready: no progress shows until it works again.`)
    const at = Date.now()
    this.heard.set(t.id, at)
    t.report = { msg: fitStatus(msg), progress, left, at, pausedAt: this.statusOf(t) === 'need' ? at : undefined }
    this.save()
    return t.report
  }

  /** a heartbeat from the extension while the agent's tool call runs: a sign of life, nothing more */
  alive(id: string, at = Date.now()) {
    this.beat.set(this.req(id).id, at)
  }

  /**
   * The agent reports done: Ready, waiting for review or merge. A branch with no changes at all (a research task, an
   * answer) has nothing to merge: it is closed, Done at once, and put away once the agent's turn ends.
   */
  async done(id: string, summary: string, facts?: string): Promise<'ready' | 'closed' | 'ended'> {
    const t = this.req(id)
    if (ended(t)) return 'ended'
    // the gates that run no test would fail the merge check: the agent hears them now, not after a turn in the lane
    const gates = t.worktree && t.base && existsSync(t.worktree) ? await Lane.fastGatesFailure(t.worktree, t.base) : undefined
    if (gates)
      throw new Error(
        `Not ready: the check's fast gates fail on this branch, so nothing was reported. Fix them, commit, then run lineclear ready ${t.id} again.\n${gates}`,
      )
    if (summary) t.said = summary
    if (facts) t.facts = facts
    t.reported = true
    t.reportedAt ??= Date.now()
    t.landing = undefined
    t.going = undefined
    // news on its pull request from now on is told to it
    t.watch ??= { since: ghNow() }
    // its job is over: so is what it said of its progress
    t.report = undefined
    if (t.worktree && t.base && existsSync(t.worktree) && !(await G.dirty(t.worktree)) && (await G.aheadCount(t.worktree, t.base)) === 0) {
      this.markClosed(t, 'done')
      if (this.agents.status(this.key(t)) !== 'working') await this.cleanup(t)
      return 'closed'
    }
    this.save()
    // told once its turn ends: an agent that merges right after never shows as waiting
    this.settleSoon(t)
    // its pull request gets the summary and is ready for review; GitHub away changes nothing here
    if (t.pr && !t.merged) this.readyForReview(t).catch(() => undefined)
    return 'ready'
  }

  protected markClosed(t: TaskRec, by: 'done' | 'close') {
    Object.assign(t, {
      closed: true,
      closedBy: by,
      doneAt: Date.now(),
      reported: true,
      landing: undefined,
      trouble: undefined,
      stopped: undefined,
      todo: undefined,
    })
    clearTimeout(this.later.get(t.id))
    this.settle(t)
    this.dropEndedOutbox()
  }

  /** whether this agent's task is done or closed */
  endedKey(key: string) {
    const t = this.task(key.split('/')[0])
    return !!t && key === this.key(t) && ended(t)
  }

  /** the refusal for a message to a task that is over, naming its state */
  overWords(t: TaskRec) {
    return `${t.id} is Done already (${t.closed ? 'nothing to merge' : 'merged'}): it has no agent, so nothing is sent to it.`
  }

  /** what waited for an agent of a task that is over is dropped: it would be retried for ever */
  dropEndedOutbox() {
    this.agents.dropOutboxWhere?.((key) => this.endedKey(key))
  }

  /** its brief never arrived: the task says so instead of showing Working */
  briefLost(key: string) {
    const t = this.task(key.split('/')[0])
    if (!t || key !== this.key(t) || ended(t)) return
    this.briefing.delete(t.id)
    t.trouble = 'brief not delivered'
    this.settle(t)
    this.save()
  }

  /**
   * Close a task with nothing to merge: Done with its summary (what it said when ready, else "Nothing to merge"). Its agent
   * stops and its space closes; its worktree and branch go when they hold nothing unsaved or unmerged, else they are
   * kept and said so. A branch with commits main lacks is refused (and its agent told) unless the human chose to discard.
   */
  async close(id: string, summary?: string, facts?: string, discard = false): Promise<{ kept: string[] }> {
    const t = this.req(id)
    if (ended(t)) throw new Error(`${t.id} is Done already (${t.closed ? 'nothing to merge' : 'merged'})`)
    const key = this.key(t)
    // a branch with commits only here is no "nothing to merge": the task goes back to its agent
    const p = this.places.space(t.project) && this.proj(t)
    const left = !discard && p && t.branch ? await this.onMachineOf(t, () => unmerged(p.path, t.branch!, t.base ?? p.base, t.id)) : 0
    if (left) {
      const why = `${t.branch} has ${left} commit${left === 1 ? '' : 's'} ${t.base ?? p?.base} lacks, so ${t.id} is not Done with nothing to merge: finish it with ready, and merge it.`
      await this.agents.send(key, why, { ensure: () => this.launch(t) }).catch(() => undefined)
      throw new Error(why)
    }
    if (this.agents.status(key) === 'working') await this.agents.interrupt(key)
    if (summary) t.said = summary
    if (facts) t.facts = facts
    this.markClosed(t, 'close')
    // putting it away closes the agent too, after looking at its work
    return { kept: (await this.cleanup(t, true))?.kept ?? [] }
  }

  /** what a task's worktree and branch hold that its base lacks, in words ("~/x (uncommitted changes)"); none: nothing is lost */
  async holds(t: TaskRec): Promise<string[]> {
    if (!this.places.space(t.project)) return []
    const p = this.proj(t)
    const on = t.base ?? p.base
    return this.onMachineOf(t, async () =>
      this.wtOf(t).holds({ repo: p.path, wt: t.worktree, branch: t.branch, base: on, squashes: await this.squashes(t, p.path, on) }),
    )
  }

  /**
   * Pause a working task: its agent is interrupted mid-work (as Esc does; it stays alive) and the task is To do, as
   * with lineclear todo, until something is written to it. Its work, worktree and chat stay.
   */
  async pause(id: string) {
    const t = this.req(id)
    if (this.statusOf(t) !== 'work') throw new Error(`${t.id} isn't working: only a working task is paused`)
    // To do first: the turn the interrupt ends is no question for you
    t.todo = true
    t.paused = this.agents.status(this.key(t)) === 'working' ? 'sent' : 'idle'
    clearTimeout(this.later.get(t.id))
    await this.agents.interrupt(this.key(t))
    this.settle(t)
    return t
  }

  /* ---------- GitHub: pull requests ---------- */

  /**
   * The project's GitHub repo when gh is logged in to its host, read live: a repo may gain its remote after it was
   * added. Each form of origin is tried (as git rewrites it, as written) for one gh is logged in to. None: the task
   * merges here. Logged in but GitHub not answering throws: that never falls back to merging here.
   */
  protected async hub(p: Space): Promise<GH.GitHub | null> {
    const was = p.github
    await this.places.recheckGithub(p)
    if (p.github !== was) this.emit('changed')
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
  protected prBody(t: TaskRec) {
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
  protected async prOf(t: TaskRec, g: GH.GitHub, cwd: string) {
    const known = t.pr ? await GH.viewPr(g, cwd, t.pr.number) : null
    // one closed on GitHub is no longer its pull request: the branch may have another
    const pr = known && known.state !== 'CLOSED' ? known : await GH.findPr(g, cwd, t.branch!)
    if ((pr?.number ?? null) !== (t.pr?.number ?? null) && (pr || known?.state === 'CLOSED')) {
      t.pr = pr ? { number: pr.number, url: pr.url } : undefined
      this.save()
    }
    return pr
  }

  protected async readyForReview(t: TaskRec, hub?: GH.GitHub) {
    const p = this.proj(t)
    const g = hub ?? (await this.hub(p))
    if (!g || !t.pr) return
    await GH.editPr(g, p.path, t.pr.number, this.prBody(t))
    await GH.readyPr(g, p.path, t.pr.number)
  }

  /** push the task's branch as it is committed, to GitHub: forced, since it is rebased on main and only its agent's */
  protected async push(t: TaskRec) {
    const sha = (await G.git(t.worktree!, 'rev-parse', 'HEAD')).out
    const r = await G.git(t.worktree!, 'push', '--quiet', '--force', 'origin', `HEAD:refs/heads/${t.branch}`)
    if (r.ok) {
      t.pushed = { sha, at: Date.now() }
      this.save()
    }
    return r
  }

  /** a GitHub step that could not reach GitHub says so, and did nothing */
  protected async onGitHub<T extends { ok: boolean }>(f: () => Promise<T>, failed: (why: string) => T): Promise<T> {
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
      () => this.openPrNow(this.req(id)),
      (text) => ({ ok: false, text }),
    )
  }

  protected async openPrNow(t: TaskRec): Promise<{ ok: boolean; text: string }> {
    if (ended(t)) return { ok: false, text: `${t.id} is Done already (${t.closed ? 'nothing to merge' : 'merged'}).` }
    if (!t.worktree || !t.branch || !t.base) return { ok: false, text: `${t.id} has no branch yet.` }
    const p = this.proj(t)
    const g = await this.hub(p)
    if (!g)
      return {
        ok: true,
        text: `No pull request: ${p.name} has no GitHub remote, or gh isn't logged in to it (gh auth status). lineclear merge ${t.id} squash-merges it here.`,
      }
    if ((await G.aheadCount(t.worktree, t.base)) === 0)
      return { ok: false, text: `${t.id} has no commits yet: commit your work, then run lineclear pr ${t.id} again.` }
    const dirty = await G.dirty(t.worktree)
    const pushed = await this.push(t)
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
      this.save()
      opened = true
    } else if (t.reported) await this.readyForReview(t, g)
    const head = (await G.git(t.worktree, 'rev-parse', '--short', 'HEAD')).out
    return {
      ok: true,
      text: `${opened ? `Opened PR #${t.pr!.number}${t.reported ? '' : ' as a draft'}` : `Pushed to PR #${t.pr!.number}`} at ${head}: ${t.pr!.url}${dirty ? '\nUncommitted changes are not in it: commit them and run lineclear pr again.' : ''}\n${(t.waitChecks ?? this.settings.ways(p.name).waitChecks) ? `Next: lineclear checks ${t.id} waits for GitHub's checks (run it with a long timeout, up to 10 minutes).` : `Merging doesn't wait for GitHub's checks (lineclear checks ${t.id} waits for any that run on it, if you want to see them).`}`,
    }
  }

  /**
   * GitHub's checks on the task's pull request, waited for while they run (up to `waitMs`). A commit Lineclear just
   * pushed, in a repo with workflows that run on pull requests, shows none for a moment: that moment is waited out, never taken as passed (after
   * it, none is none: the repo's workflows may not run on pull requests). GitHub not answering three times running
   * is said, not waited on.
   */
  protected async checksOf(t: TaskRec, g: GH.GitHub, n: number, waitMs: number): Promise<GH.PrChecks> {
    const t0 = Date.now()
    const head = (await G.git(t.worktree!, 'rev-parse', 'HEAD')).out
    const expect = await GH.hasPrWorkflows(t.worktree!)
    let errors = 0
    for (;;) {
      const c = await GH.prChecks(g, t.worktree!, n)
      errors = c.state === 'error' ? errors + 1 : 0
      const early = c.state === 'none' && expect && t.pushed?.sha === head && Date.now() - t.pushed.at < CHECKS_SHOW
      if ((c.state !== 'pending' && c.state !== 'error' && !early) || errors >= 3) return this.withTests(g, t.worktree!, c)
      if (Date.now() - t0 + CHECKS_EVERY > waitMs) return early ? { ...c, state: 'pending' } : this.withTests(g, t.worktree!, c)
      await Bun.sleep(CHECKS_EVERY)
    }
  }

  /** failed checks with the names of the tests their job logs show as failed */
  private async withTests(g: GH.GitHub, cwd: string, c: GH.PrChecks): Promise<GH.PrChecks> {
    if (c.state !== 'fail') return c
    const failed = await Promise.all(c.failed.map(async (f) => (f.link ? { ...f, tests: await GH.failedTestNames(g, cwd, f.link) } : f)))
    return { ...c, failed }
  }

  /** a ready task's next step into main (Merging), or none: Ready again, or back at work */
  protected land(t: TaskRec, step?: Lane.Landing['step'], due?: number) {
    // a merge the lane released goes no further
    if (step && this.cut.has(this.inRun.getStore() ?? -1)) throw new Error(`${t.id}'s merge was released by the lane`)
    if (!t.reported || ended(t)) return
    t.landing = step ? { step, at: Date.now(), due } : undefined
    this.save()
    this.settle(t)
  }

  /** when GitHub's checks at `head` should be through: from when it was pushed, as long as they took lately */
  protected async checksDue(t: TaskRec, p: Space, g: GH.GitHub, head: string) {
    let took = this.took.get(p.path)
    if (!took || Date.now() - took.at > 30 * 60_000) {
      took = { ms: await GH.checksTook(g, p.path).catch(() => undefined), at: Date.now() }
      this.took.set(p.path, took)
    }
    if (took.ms === undefined) return undefined
    return (t.pushed?.sha === head ? t.pushed.at : Date.now()) + took.ms
  }

  /** which of GitHub's checks failed, and where to see why */
  protected checksFailed(n: number, c: GH.PrChecks) {
    const link = c.failed.find((f) => f.link)?.link
    const tests = [...new Set(c.failed.flatMap((f) => f.tests ?? []))]
    return `GitHub's checks failed on PR #${n}: ${c.failed.map((f) => f.name).join(', ')}.${tests.length ? ` Failing tests: ${tests.join(', ')}.` : ''}${link ? ` See ${link} (gh run view --log-failed shows why).` : ''}`
  }

  protected fixIt = (t: TaskRec) =>
    `Fix it, commit, push with lineclear pr ${t.id}, wait with lineclear checks ${t.id}, then run lineclear merge ${t.id} again.`

  protected async checksNow(t: TaskRec, waitMs: number): Promise<{ ok: boolean; text: string }> {
    if (!t.worktree || !t.branch) return { ok: false, text: `${t.id} has no branch yet.` }
    const p = this.proj(t)
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
  protected toldFailed(t: TaskRec, head: string, c: GH.PrChecks) {
    t.watch = { ...t.watch, since: t.watch?.since ?? ghNow(), failed: failKey(head, c) }
    this.save()
  }

  /**
   * Put a finished task's place away: agent, space, worktree and branch, keeping whatever holds unsaved or unmerged
   * work (said in news, and in lineclear status). Marked cleaned only once done, so one cut short (a restart) or put
   * off (something still runs in its space) is tried again.
   */
  protected async cleanup(t: TaskRec, quiet = false) {
    const p = this.places.space(t.project)
    if (!p || this.cleaning.has(t.id)) return
    this.cleaning.add(t.id)
    try {
      const r = await this.putAway(t, p.path, p.base)
      if (r.busy) return r
      const news = r.kept.length && JSON.stringify(r.kept) !== JSON.stringify(t.kept)
      t.kept = r.kept.length ? r.kept : undefined
      t.cleaned = true
      this.save()
      if (news && !quiet)
        this.emit('news', t.project, `${t.id} ${t.closed ? 'is done, nothing to merge' : 'was merged'}; kept ${r.kept.join(', ')}`, 'done', {
          task: t.id,
          event: t.closed ? 'closed' : 'merged',
        })
      return r
    } finally {
      this.cleaning.delete(t.id)
    }
  }

  /** a merged task's branch is checked against its squash merge: the one recorded, else (merged before one was) the
   *  commits its subject names */
  protected async putAway(t: TaskRec, repo: string, base: string) {
    const key = this.key(t)
    const on = t.base ?? base
    return this.onMachineOf(t, async () =>
      this.wtOf(t).putAway({
        repo,
        wt: t.worktree,
        branch: t.branch,
        base: on,
        squashes: await this.squashes(t, repo, on),
        label: labelOf(t),
        agentPane: this.agents.info(key)?.pane_id,
        closeAgent: () => this.agents.finish(key),
      }),
    )
  }

  protected async squashes(t: TaskRec, repo: string, on: string) {
    return !t.merged ? [] : t.squash ? [t.squash] : G.squashesOf(repo, on, t.id)
  }
}
