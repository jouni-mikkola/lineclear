import { existsSync } from '../mfs.ts'
import { hidden } from '../agents.ts'
import { placeId, type Space } from '../places.ts'
import { prNewsLine } from '../prompts.ts'
import * as G from './git.ts'
import * as GH from './github.ts'
import { type TaskRec, ended, labelOf, CHECKS_WAIT, MAIN_WATCH, failKey, quote, COMMENT, ghNow } from './engine-helpers.ts'
import { EngineLand } from './merge.ts'

export class EngineMerge extends EngineLand {
  /** lineclear checks: wait for GitHub's checks on the task's pull request, at the commit this machine has */
  checks(id: string, waitMs = CHECKS_WAIT): Promise<{ ok: boolean; text: string }> {
    return this.onGitHub(
      () => this.checksNow(this.req(id), waitMs),
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
    while (this.watching) await this.watching
    const look = this.lookAtPrs()
    this.watching = look
    try {
      await look
    } finally {
      this.watching = undefined
    }
  }

  protected async lookAtPrs() {
    const hubs = new Map<string, G.GitHub | null>()
    for (const t of this.tasks.filter((t) => t.reported && t.pr && t.worktree && !ended(t) && !t.archived && !t.stopped)) {
      if (['working', 'blocked'].includes(this.agents.status(this.key(t)))) continue
      const p = this.places.space(t.project)
      if (!p || !existsSync(t.worktree!)) continue
      if (!hubs.has(p.path)) hubs.set(p.path, await this.hub(p).catch(() => null))
      const g = hubs.get(p.path)
      if (g) await this.watchPr(t, g).catch(() => undefined)
    }
  }

  protected async watchPr(t: TaskRec, g: G.GitHub) {
    const pr = await this.prOf(t, g, t.worktree!)
    // merged on GitHub by hand: it is Done here too, or the tasks queued after it wait for ever
    if (pr?.state === 'MERGED') return void (await this.mergedOnGitHub(t, this.proj(t), `PR #${pr.number} was merged on GitHub`))
    if (pr?.state !== 'OPEN') return
    const w = (t.watch ??= { since: ghNow() })
    const news: string[] = []
    const what: string[] = []
    const c = await GH.prChecks(g, t.worktree!, pr.number)
    const failed = c.state === 'fail' ? failKey(pr.headRefOid, c) : c.state === 'pass' ? undefined : w.failed
    if (c.state === 'fail' && failed !== w.failed) {
      for (const f of c.failed) {
        const log = f.link ? await GH.failedLog(g, t.worktree!, f.link) : undefined
        news.push(`- Check failed: ${f.name}${f.link ? ` (${f.link})` : ''}${log ? `. Its log ends:\n${quote(log)}` : ''}`)
      }
      what.push(`${c.failed.map((f) => f.name).join(', ')} failed`)
    }
    const all = await GH.prComments(g, t.worktree!, pr.number)
    const seen = new Set(w.seen)
    // an approval or a review with no words of its own (it only carries its line comments) is no news
    const fresh = (all ?? []).filter((x) => !seen.has(x.id) && x.at >= w.since && (x.body || x.state === 'CHANGES_REQUESTED'))
    for (const x of fresh)
      news.push(
        `- ${x.state ? (COMMENT[x.state] ?? 'Review') : 'Comment'} by ${x.who}${x.where ? ` on ${x.where}` : ''} (${x.url}):\n${quote(x.body || '(no words)')}`,
      )
    if (fresh.length) what.push(fresh.length === 1 ? 'a new comment' : `${fresh.length} new comments`)
    // put to work, or at a prompt, while GitHub was asked: it hears all this next time
    if (news.length && ['working', 'blocked'].includes(this.agents.status(this.key(t)))) return
    w.failed = failed
    if (all) w.seen = all.map((x) => x.id)
    this.save()
    if (!news.length) return this.nudgeToMerge(t, pr.number, c)
    const id = `pr:${t.id}:${Date.now()}`
    this.chats.post(this.key(t), { id, card: { id, task: t.id, status: 'work', text: `woken: ${what.join(' and ')} on PR #${pr.number}`, pr: t.pr } })
    await this.sendBack(t, hidden(prNewsLine(t.id, t.pr!, news), 'github', { task: t.id, pr: String(t.pr!.number) }))
  }
  /**
   * GitHub's checks on main after merges, which a task merges without waiting for (Settings), or that merged cleanly
   * but clash: once a run on main fails, its coordinator hears it once, with the run and the tasks merged since main
   * was last green. What follows (a fix task) is its call. Looked at while a task merged through its pull request
   * lately, or main is red, until it is green again.
   */
  async watchMains() {
    if (this.watchingMain) return
    this.watchingMain = true
    try {
      for (const p of this.places.spaces) await this.watchMain(p).catch(() => undefined)
    } finally {
      this.watchingMain = false
    }
  }

  protected async watchMain(p: Space) {
    const red = this.data.red?.[p.path]
    const lately = Date.now() - MAIN_WATCH
    if (!red && !this.tasks.some((t) => t.merged && t.pr && (t.doneAt ?? 0) > lately && this.places.space(t.project) === p)) return
    const g = await this.hub(p).catch(() => null)
    const runs = g && (await GH.branchRuns(g, p.path, p.base))
    // the newest commit on main its runs have a verdict on
    const i = runs ? runs.findIndex((r) => r.state !== 'pending') : -1
    if (!g || !runs || i < 0) return
    const now = runs[i]
    if (now.state === 'pass') {
      if (red) delete this.data.red![p.path]
      if (red) this.save()
      return
    }
    // told once while it stays red, whatever else merges meanwhile
    if (red) return
    ;(this.data.red ??= {})[p.path] = now.sha
    this.save()
    const green = runs.slice(i + 1).find((r) => r.state === 'pass')?.sha
    await G.git(p.path, 'fetch', '--quiet', 'origin', p.base)
    const log = await G.git(p.path, 'log', '--format=%s', '-n', '20', green ? `${green}..${now.sha}` : `${now.sha}^!`)
    const merged = log.ok ? log.out.split('\n').filter(Boolean) : []
    const f = now.failed[0]
    const tail = await GH.failedLog(g, p.path, f.link)
    const ids = merged.map((m) => m.match(/^([A-Z][A-Z0-9]*-\d+):/)?.[1]).filter((x): x is string => !!x)
    this.emit(
      'news',
      placeId.space(p.name),
      [
        `${p.base} went red on GitHub at ${now.sha.slice(0, 7)}: ${now.failed.map((x) => `${x.name} failed (${x.link})`).join(', ')}.`,
        `Merged since it was last green${green ? ` (${green.slice(0, 7)})` : ''}: ${merged.length ? merged.join('; ') : 'none Lineclear can tell'}.`,
        tail ? `Its log ends:\n${quote(tail)}` : '',
        'A fix-forward task follows if you decide so: its brief names the failing run and these merges',
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
   * unsaved or unmerged work. Nothing is touched while herdr does not answer.
   */
  async sweep() {
    const spaces = await this.wt.workspaces().catch(() => null)
    if (!spaces) return
    for (const t of this.tasks.filter(ended)) {
      const p = this.places.space(t.project)
      const st = this.agents.status(this.key(t))
      if (!p || t.machine || st === 'working' || (t.cleaned && st !== 'gone')) continue
      const left =
        !t.cleaned ||
        (!!t.worktree && existsSync(t.worktree)) ||
        (!!t.branch && (await G.branchExists(p.path, t.branch))) ||
        !!(await this.wt.spaceOf(t.worktree, labelOf(t), spaces))
      if (left) await this.cleanup(t, true).catch(() => undefined)
    }
    await this.wt.closeRepoSpaces()
  }

  /** finished tasks that kept a worktree or branch, and why: for lineclear status */
  keptLeftovers() {
    return this.tasks.filter((t) => ended(t) && t.kept?.length).map((t) => `${t.id} ${t.kept!.join(', ')}`)
  }
}
