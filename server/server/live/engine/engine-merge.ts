import type { Engine } from './engine.ts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exists } from '../mfs.ts'
import { hidden } from '../agents.ts'
import { placeId, type Space } from '../places.ts'
import { prNewsLine } from '../prompts.ts'
import * as G from './git.ts'
import * as GH from './github.ts'
import * as News from './github-news.ts'
import { type TaskRec, ended, CHECKS_WAIT, MAIN_WATCH, failKey, quote, COMMENT, ghNow } from './engine-helpers.ts'
import { RedMainWatch } from './lane-watch.ts'

const REVERTED = 'Lineclear reverted that commit; bring its change back, fixed.'

export class EngineMerge {
  constructor(private readonly e: Engine) {}

  /** lineclear checks: wait for GitHub's checks on the task's pull request, at the commit this machine has */
  checks(id: string, waitMs = CHECKS_WAIT): Promise<{ ok: boolean; text: string }> {
    return this.e.prPart.onGitHub(
      () => this.e.prPart.checksNow(this.e.req(id), waitMs),
      (text) => ({ ok: false, text }),
    )
  }

  /**
   * News on done tasks' pull requests: checks that failed, and what someone wrote on it (a review, a comment) since its
   * agent reported done. Its agent hears each once, in <lineclear> tags, which wakes it; what to do about it is its own
   * call (the lineclear-agent skill). Only an agent at rest is told: one at work, or at a prompt, hears it next time.
   */
  async watchPrs() {
    // a call during a look waits for it and looks again: a look begun before the caller's change would miss it
    while (this.e.watching) await this.e.watching
    const look = this.lookAtPrs()
    this.e.watching = look
    try {
      await look
    } finally {
      this.e.watching = undefined
    }
  }

  /** the repo's GitHub when gh reaches it; null (its state in the repo watch says why) when not: down is never "no GitHub" */
  private async hubOrState(p: Space): Promise<GH.GitHub | null> {
    try {
      const g = await this.e.prPart.hub(p)
      // the space's own state: only a read of the repo marks the repo itself ok
      this.e.repos.mark(p.path, g ? 'ok' : 'unauthenticated')
      return g
    } catch (e) {
      this.e.repos.mark(p.path, 'down', (e as Error).message)
      return null
    }
  }

  /** one look at the repos' tasks: each repo is read once, whatever number of tasks it holds */
  async lookAtPrs() {
    const hubs = new Map<string, GH.GitHub | null>()
    const opens = new Map<string, Map<number, News.OpenPr> | null>()
    for (const t of this.e.tasks.filter((t) => t.reported && t.pr && t.worktree && !ended(t) && !t.archived && !t.stopped)) {
      if (['working', 'blocked'].includes(this.e.agents.status(this.e.key(t)))) continue
      const p = this.e.places.space(t.project)
      if (!p || !(await exists(t.worktree!))) continue
      if (!hubs.has(p.path)) hubs.set(p.path, await this.hubOrState(p))
      const g = hubs.get(p.path)
      if (!g) continue
      const key = GH.repoKey(g)
      if (!opens.has(key)) opens.set(key, await this.readOpen(g, p.path))
      const open = opens.get(key)
      if (!open) continue
      try {
        await this.watchPr(t, g, open.get(t.pr!.number))
      } catch (e) {
        this.watchFailed(g, e)
      }
    }
  }

  private async readOpen(g: GH.GitHub, cwd: string) {
    try {
      return (await this.e.repos.read(g, cwd, 0)).prs
    } catch (e) {
      this.watchFailed(g, e)
      return null
    }
  }

  /** GitHub not answering is the repo's state (down); anything else is a fault in Lineclear, said once per look */
  private watchFailed(g: GH.GitHub, e: unknown) {
    if (e instanceof GH.GhDown) this.e.repos.mark(GH.repoKey(g), 'down', e.message)
    else console.error(`watching ${GH.repoKey(g)}:`, e)
  }

  /** `open` is the task's pull request in the repo's read when it is open on GitHub; else it is asked for (merged, closed) */
  async watchPr(t: TaskRec, g: GH.GitHub, open?: News.OpenPr) {
    const pr = open?.pr ?? (await this.e.prPart.prOf(t, g, t.worktree!))
    // merged on GitHub by hand: it is Done here too, or the tasks queued after it wait for ever
    if (pr?.state === 'MERGED') return void (await this.e.mergeGitHubPart.mergedOnGitHub(t, this.e.proj(t), `PR #${pr.number} was merged on GitHub`))
    if (pr?.state !== 'OPEN') return
    const w = (t.watch ??= { since: ghNow() })
    const news: string[] = []
    const what: string[] = []
    const c = open?.checks ?? (await GH.prChecks(g, t.worktree!, pr.number))
    const failed = c.state === 'fail' ? failKey(pr.headRefOid, c) : c.state === 'pass' ? undefined : w.failed
    if (c.state === 'fail' && failed !== w.failed) {
      for (const f of c.failed) {
        const log = f.link ? await News.failedLog(g, t.worktree!, f.link) : undefined
        news.push(`- Check failed: ${f.name}${f.link ? ` (${f.link})` : ''}${log ? `. Its log ends:\n${quote(log)}` : ''}`)
      }
      what.push(`${c.failed.map((f) => f.name).join(', ')} failed`)
    }
    const all = open?.comments ?? (await News.prComments(g, t.worktree!, pr.number))
    const seen = new Set(w.seen)
    // an approval or a review with no words of its own (it only carries its line comments) is no news
    const fresh = (all ?? []).filter((x) => !seen.has(x.id) && x.at >= w.since && (x.body || x.state === 'CHANGES_REQUESTED'))
    for (const x of fresh)
      news.push(
        `- ${x.state ? (COMMENT[x.state] ?? 'Review') : 'Comment'} by ${x.who}${x.where ? ` on ${x.where}` : ''} (${x.url}):\n${quote(x.body || '(no words)')}`,
      )
    if (fresh.length) what.push(fresh.length === 1 ? 'a new comment' : `${fresh.length} new comments`)
    // put to work, or at a prompt, while GitHub was asked: it hears all this next time
    if (news.length && ['working', 'blocked'].includes(this.e.agents.status(this.e.key(t)))) return
    w.failed = failed
    if (all) w.seen = all.map((x) => x.id)
    this.e.save()
    if (!news.length) return this.e.landPart.nudgeToMerge(t, pr.number, c)
    const id = `pr:${t.id}:${Date.now()}`
    this.e.chats.post(this.e.key(t), { id, card: { id, task: t.id, status: 'work', text: `woken: ${what.join(' and ')} on PR #${pr.number}`, pr: t.pr } })
    await this.e.mergeGitHubPart.sendBack(t, hidden(prNewsLine(t.id, t.pr!, news), 'github', { task: t.id, pr: String(t.pr!.number) }))
  }
  /**
   * GitHub's checks on main after merges, which a task merges without waiting for (Settings), or that merged cleanly
   * but clash: once a run on main fails, its coordinator hears it once, with the run and the tasks merged since main
   * was last green. What follows (a fix task) is its call. Looked at while a task merged through its pull request
   * lately, or main is red, until it is green again.
   */
  async watchMains() {
    if (this.e.watchingMain) return
    this.e.watchingMain = true
    try {
      for (const p of this.e.places.spaces) {
        try {
          await this.e.watchMain(p)
        } catch (e) {
          const g = await GH.github(p.path)
          if (g) this.watchFailed(g, e)
          else console.error(`watching ${p.name}:`, e)
        }
      }
    } finally {
      this.e.watchingMain = false
    }
  }

  redMain = new RedMainWatch()

  /** main is green: the fix tasks of older reds have nothing left to merge. One with commits of its own stays: close refuses it. */
  private async closeOldFixes(p: Space) {
    // a reverted red is what made main green: its task still has the change to bring back
    for (const t of this.e.tasks.filter(
      (x) => x.by === 'main-green' && !ended(x) && !x.machine && !x.desc.includes(REVERTED) && this.e.places.space(x.project) === p,
    ))
      await this.e.close(t.id, `nothing to merge: ${p.base} is green`).catch(() => undefined)
  }

  /** A revert commit of the sha pushed to the base, made in a scratch worktree so no checkout is touched. */
  private async revertOnBase(p: Space, sha: string): Promise<boolean> {
    const dir = mkdtempSync(join(tmpdir(), 'red-main-'))
    try {
      if (!(await G.git(p.path, 'worktree', 'add', '--detach', dir, `origin/${p.base}`)).ok) return false
      const done = (await G.git(dir, 'revert', '--no-edit', sha)).ok && (await G.git(dir, 'push', 'origin', `HEAD:${p.base}`)).ok
      if (!done) await G.git(dir, 'revert', '--abort')
      return done
    } finally {
      await G.git(p.path, 'worktree', 'remove', '--force', dir)
    }
  }

  async watchMain(p: Space) {
    const red = this.e.data.red?.[p.path]
    const lately = Date.now() - MAIN_WATCH
    if (!red && !this.e.tasks.some((t) => t.merged && t.pr && (t.doneAt ?? 0) > lately && this.e.places.space(t.project) === p)) return
    const g = await this.hubOrState(p)
    const runs = g && (await this.e.repos.branchRuns(g, p.path, p.base, 0))
    // the newest commit on main its runs have a verdict on
    const i = runs ? runs.findIndex((r) => r.state !== 'pending') : -1
    if (!g || !runs || i < 0) return
    const now = runs[i]
    if (now.required === 'fail') this.e.heldRed.set(p.path, now.sha)
    else this.e.heldRed.delete(p.path)
    if (now.state === 'pass') {
      if (red) {
        delete this.e.data.red![p.path]
        this.e.save()
        await this.closeOldFixes(p)
      }
      return
    }
    // told once while it stays red, whatever else merges meanwhile
    if (red) return
    ;(this.e.data.red ??= {})[p.path] = now.sha
    this.e.save()
    const green = runs.slice(i + 1).find((r) => r.state === 'pass')?.sha
    await G.git(p.path, 'fetch', '--quiet', 'origin', p.base)
    const log = await G.git(p.path, 'log', '--format=%s', '-n', '20', green ? `${green}..${now.sha}` : `${now.sha}^!`)
    const merged = log.ok ? log.out.split('\n').filter(Boolean) : []
    const f = now.failed[0]
    const tail = await News.failedLog(g, p.path, f.link)
    const ids = merged.map((m) => m.match(/^([A-Z][A-Z0-9]*-\d+):/)?.[1]).filter((x): x is string => !!x)
    // one fix task per repo and red: the first loop to claim the red files it, the others only say so
    const claim = await GH.claimRef(g, p.path, `red-${now.sha}`, now.sha)
    const heldBy = this.e.tasks.find((x) => x.by === 'main-green' && !ended(x) && x.title.startsWith(`Fix ${p.base} red at ${now.sha.slice(0, 7)}`))
    if (claim !== 'held')
      await this.redMain.look(
        { sha: now.sha, conclusion: 'failure' },
        {
          // a failure outside the required check gets a fix task only: reverting a commit for it would undo good work
          revert: async (sha) => now.required === 'fail' && (await this.revertOnBase(p, sha)),
          fixTask: async (sha, reverted) => {
            const failing = now.failed.map((x) => `${x.name} (${x.link})`).join(', ')
            this.e.add({
              project: p.name,
              base: p.base,
              by: 'main-green',
              title: `Fix ${p.base} red at ${sha.slice(0, 7)}`,
              desc: `${p.base} went red at ${sha}: ${failing}. ${reverted ? REVERTED : 'The revert failed; fix it forward.'} Merged since it was last green: ${merged.join('; ') || 'unknown'}.`,
            })
          },
        },
      )
    this.e.emit(
      'news',
      placeId.space(p.name),
      [
        `${p.base} went red on GitHub at ${now.sha.slice(0, 7)}: ${now.failed.map((x) => `${x.name} failed (${x.link})`).join(', ')}.`,
        `Merged since it was last green${green ? ` (${green.slice(0, 7)})` : ''}: ${merged.length ? merged.join('; ') : 'none Lineclear can tell'}.`,
        tail ? `Its log ends:\n${quote(tail)}` : '',
        claim === 'held'
          ? `${p.base} red, fixed by ${heldBy ? `${heldBy.id} on ${heldBy.machine ?? 'this machine'}` : 'a task on another machine'}.`
          : 'A revert of that commit was tried and a fix-forward task opened: its brief names the failing run and these merges',
      ]
        .filter(Boolean)
        .join('\n'),
      'red',
      { task: ids[0] ?? '', event: 'main-red' },
      { red: p.base, text: `went red: ${now.failed.map((x) => x.name).join(', ')} failed` },
    )
  }

  /**
   * Leftovers of finished tasks, put away: at startup and every hour, so none pile up. Only tasks Lineclear made and
   * merged or closed, never one whose agent is at work (or that you talk to again after its clean-up), and never what holds
   * unsaved or unmerged work. Git alone does it: herdr being down changes nothing.
   */
  async sweep() {
    for (const t of this.e.tasks.filter(ended)) {
      const p = this.e.places.space(t.project)
      const st = this.e.agents.status(this.e.key(t))
      if (!p || t.machine || st === 'working' || (t.cleaned && st !== 'gone')) continue
      const left = !t.cleaned || (!!t.worktree && (await exists(t.worktree))) || (!!t.branch && (await G.branchExists(p.path, t.branch)))
      if (left) {
        try {
          await this.e.handoffPart.cleanup(t, true)
        } catch (e) {
          console.error(`sweeping ${t.id}:`, e)
        }
      }
    }
  }

  /** finished tasks that kept a worktree or branch, and why: for lineclear status */
  keptLeftovers() {
    return this.e.tasks.filter((t) => ended(t) && t.kept?.length).map((t) => `${t.id} ${t.kept!.join(', ')}`)
  }
}
