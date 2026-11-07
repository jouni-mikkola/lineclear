import { resetMergeSetting, ghBin, onGitHub, waitForChecks } from './engine-merge-fixture.ts'
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sh, world, until, started } from './engine-world.ts'

describe('on GitHub: news, checks and the default way in', () => {
  test("news on a done task's pull request wakes its agent once: a failed check with its log's end, new comments", async () => {
    const w = world()
    const g = onGitHub({ checks: [{ name: 'test', bucket: 'pass' }] })
    const { t, key } = await started(w, g.dir, 'ghnews')
    writeFileSync(join(t.worktree!, 'x.txt'), 'x\n')
    sh('git add -A && git commit -qm x', t.worktree!)
    await w.engine.openPr(t.id)
    // not done yet: nothing is watched
    g.set({ checks: [{ name: 'lint', bucket: 'fail' }] })
    w.agentIs(key, 'idle')
    await w.engine.watchPrs()
    expect(w.sent.length).toBe(0)
    // a failure it saw itself (lineclear checks) and reported done with is no news
    expect((await w.engine.checks(t.id, 0)).ok).toBe(false)
    await w.engine.done(t.id, 'x; lint is red on main too')
    await w.engine.watchPrs()
    expect(w.sent.length).toBe(0)
    // a check fails and people write on it; a comment from before it was done is old news
    const pulls = 'repos/acme/app/pulls/1'
    g.set({
      checks: [
        { name: 'test', bucket: 'fail', link: 'https://github.com/acme/app/actions/runs/7/job/9' },
        { name: 'lint', bucket: 'pass' },
      ],
      // as GitHub logs a whole job: what failed, then the clean-up steps after it
      logs: {
        '9': ['ok 1', 'expected 1 to be 2', '##[error]Process completed with exit code 1.', 'Post job cleanup.', 'Cleaning up orphan processes']
          .map((l) => `2026-10-26T10:00:00.1234567Z ${l}`)
          .join('\n'),
      },
      api: {
        [`${pulls}/reviews`]: [
          {
            id: 1,
            user: { login: 'ann' },
            body: 'Please rename it.',
            state: 'CHANGES_REQUESTED',
            html_url: 'https://github.com/acme/app/pull/1#r1',
            submitted_at: '2099-01-01T00:00:00Z',
          },
          {
            id: 2,
            user: { login: 'bob' },
            body: '',
            state: 'COMMENTED',
            html_url: 'https://github.com/acme/app/pull/1#r2',
            submitted_at: '2099-01-01T00:00:01Z',
          },
        ],
        // drafted long before its review was sent: news all the same
        [`${pulls}/comments`]: [
          {
            id: 3,
            pull_request_review_id: 2,
            user: { login: 'bob' },
            body: 'Typo here.',
            path: 'x.txt',
            line: 1,
            html_url: 'https://github.com/acme/app/pull/1#c3',
            created_at: '2000-01-01T00:00:00Z',
          },
        ],
        'repos/acme/app/issues/1/comments': [
          { id: 4, user: { login: 'cy' }, body: 'Old news.', html_url: 'https://github.com/acme/app/pull/1#i4', created_at: '2000-01-01T00:00:00Z' },
        ],
      },
    })
    await w.engine.watchPrs()
    expect(w.sent.length).toBe(1)
    const told = w.sent[0]
    expect(told.key).toBe(key)
    expect(told.text).toMatch(/^<lineclear><github task="[^"]+" pr="1">GitHub news on PR #1 \(https:\/\/github.com\/acme\/app\/pull\/1\)/)
    expect(told.text).toContain(
      '- Check failed: test (https://github.com/acme/app/actions/runs/7/job/9). Its log ends:\n    ok 1\n    expected 1 to be 2\n    ##[error]Process completed with exit code 1.\n- ',
    )
    expect(told.text).not.toContain('clean')
    expect(told.text).toContain('- Changes requested by ann (https://github.com/acme/app/pull/1#r1):\n    Please rename it.')
    expect(told.text).toContain('- Comment by bob on x.txt:1 (https://github.com/acme/app/pull/1#c3):\n    Typo here.')
    expect(told.text).not.toContain('Old news')
    expect(told.text).not.toContain('#r2')
    expect(told.text).toContain('lineclear-agent skill')
    expect(w.posted.at(-1)).toMatchObject({ key, card: { status: 'work', text: 'woken: test failed and 2 new comments on PR #1' } })
    // it is at work again, and hears nothing more until it reports done
    expect(w.engine.statusOf(t)).toBe('work')
    await w.engine.watchPrs()
    expect(w.sent.length).toBe(1)
    // done again: the same failure and comments are not told twice
    await w.engine.done(t.id, 'x')
    await w.engine.watchPrs()
    expect(w.sent.length).toBe(1)
    // an agent at work hears news only once it rests
    const notes = g.gh().api!
    g.set({
      api: {
        ...notes,
        'repos/acme/app/issues/1/comments': [
          { id: 5, user: { login: 'cy' }, body: 'Ship it?', html_url: 'https://github.com/acme/app/pull/1#i5', created_at: '2099-01-02T00:00:00Z' },
        ],
      },
    })
    w.agentIs(key, 'working')
    await w.engine.watchPrs()
    expect(w.sent.length).toBe(1)
    w.agentIs(key, 'idle')
    await w.engine.watchPrs()
    expect(w.sent.length).toBe(2)
    expect(w.sent[1].text).toContain('- Comment by cy (https://github.com/acme/app/pull/1#i5):\n    Ship it?')
    expect(w.sent[1].text).not.toContain('Check failed')
  }, 90000)

  test('a branch just pushed whose repo has workflows on pull requests waits for its checks to show, never taking none as passed', async () => {
    const w = world()
    const g = onGitHub()
    waitForChecks(w)
    const { t } = await started(w, g.dir, 'ghwf')
    mkdirSync(join(t.worktree!, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(t.worktree!, '.github', 'workflows', 'ci.yml'), 'on:\n  pull_request:\n  push:\n')
    sh('git add -A && git commit -qm ci', t.worktree!)
    const m = await w.engine.merge(t.id, { self: true })
    expect(m.ok).toBe(false)
    expect(m.error).toContain('just pushed')
    expect(g.gh().prs[0].state).toBe('OPEN')
    // a while later still none: they didn't run on it after all, and it merges
    t.pushed!.at = 0
    expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
  }, 240000)

  test('a branch just pushed whose workflows run only on main has no checks to wait for', async () => {
    const w = world()
    const g = onGitHub()
    waitForChecks(w)
    const { t } = await started(w, g.dir, 'ghmain')
    mkdirSync(join(t.worktree!, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(t.worktree!, '.github', 'workflows', 'ci.yml'), '# no run on pull requests\non:\n  push:\n    branches: [main]\n  workflow_dispatch:\n')
    sh('git add -A && git commit -qm ci', t.worktree!)
    expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
  })

  test("by default it merges without waiting for GitHub's checks, but never on one already failed at its commit", async () => {
    const w = world()
    const g = onGitHub({ checks: [{ name: 'test', bucket: 'pending' }] })
    const { t } = await started(w, g.dir, 'ghnowait')
    writeFileSync(join(t.worktree!, 'x.txt'), 'x\n')
    sh('git add -A && git commit -qm x', t.worktree!)
    expect((await w.engine.openPr(t.id)).text).toContain("Merging doesn't wait for GitHub's checks")
    g.set({ checks: [{ name: 'test', bucket: 'fail', link: 'https://github.com/acme/app/actions/runs/7' }] })
    const f = await w.engine.merge(t.id, { self: true })
    expect(f.ok).toBe(false)
    expect(f.error).toContain("GitHub's checks failed on PR #1: test.")
    expect(g.gh().prs[0].state).toBe('OPEN')
    // fixed: a new commit, its checks just started
    writeFileSync(join(t.worktree!, 'x.txt'), 'fixed\n')
    sh('git commit -qam fix', t.worktree!)
    g.set({ checks: [{ name: 'test', bucket: 'pending' }] })
    expect(await w.engine.merge(t.id, { self: true })).toEqual({ ok: true, note: 'merged PR #1 on GitHub, not waiting for its checks' })
    expect(g.gh().prs[0].state).toBe('MERGED')
    // the brief's Merge line says so too
    expect(t.desc).toContain("Don't wait for GitHub's checks.")
  })

  test('main going red on GitHub after merges tells its coordinator once, with the run and what merged since green', async () => {
    const w = world()
    const g = onGitHub()
    const { t } = await started(w, g.dir, 'ghred')
    writeFileSync(join(t.worktree!, 'x.txt'), 'x\n')
    sh('git add -A && git commit -qm x', t.worktree!)
    const green = sh('git rev-parse main', g.bare)
    // other tests' tasks merged lately too (one store): only this one's project is watched
    for (const x of w.engine.tasks) x.doneAt = 0
    expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
    const red = sh('git rev-parse main', g.bare)
    const run = (headSha: string, conclusion: string, n: number, status = 'completed') => ({
      headSha,
      status,
      conclusion,
      url: `https://github.com/acme/app/actions/runs/${n}`,
      workflowName: 'Check',
    })
    // still running on the merge: nothing yet
    g.set({ runs: [run(red, '', 3, 'in_progress'), run(green, 'success', 2)] })
    await w.engine.watchMains()
    const before = w.news.length
    expect(w.news.length).toBe(before)
    // a newer push cancelled one run; the other failed
    g.set({
      runs: [run(red, 'cancelled', 4), run(red, 'failure', 3), run(green, 'success', 2)],
      api: { 'repos/acme/app/actions/runs/3/jobs': [9] },
      logs: { '9': 'expected 1 to be 2\n##[error]Process completed with exit code 1.' },
    })
    await w.engine.watchMains()
    expect(w.news.length).toBe(before + 1)
    const told = w.news.at(-1)!
    expect(told).toContain(`main went red on GitHub at ${red.slice(0, 7)}: Check failed (https://github.com/acme/app/actions/runs/3).`)
    expect(told).toContain(`Merged since it was last green (${green.slice(0, 7)}): ${t.id}: Say hello (#1).`)
    expect(told).toContain('    expected 1 to be 2')
    expect(told).toContain('fix-forward task')
    // for the project's own coordinator, by its place id (a folder's path reached no chat)
    expect(w.newsTo.at(-1)).toBe(t.project)
    expect(w.places.space(t.project)).toBeDefined()
    // told once while it stays red
    await w.engine.watchMains()
    expect(w.news.length).toBe(before + 1)
    // green again, then red again: told again
    g.set({ runs: [run('b'.repeat(40), 'success', 5), run(red, 'failure', 3)] })
    await w.engine.watchMains()
    g.set({ runs: [run('c'.repeat(40), 'failure', 6), run('b'.repeat(40), 'success', 5)] })
    await w.engine.watchMains()
    expect(w.news.length).toBe(before + 2)
  })

  test('GitHub slow on the merge: one lineclear merge waits for its result, and asked again while it runs joins the same merge', async () => {
    const w = world()
    const g = onGitHub()
    const { t } = await started(w, g.dir, 'mergeslow')
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    sh('git add -A && git commit -qm "add hello"', t.worktree!)
    await w.engine.done(t.id, 'Added hello.txt.')
    g.set({ mergeSlow: 2500 })
    // far shorter than the merge: the deadline no longer cuts the caller off
    w.engine.mergeDeadline = 300
    const first = w.engine.merge(t.id, { self: true })
    const again = w.engine.merge(t.id, { self: true })
    expect(await first).toEqual({ ok: true, note: 'merged PR #1 on GitHub, not waiting for its checks' })
    expect(await again).toEqual({ ok: true, note: 'merged PR #1 on GitHub, not waiting for its checks' })
    expect(g.gh().calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'merge')).toHaveLength(1)
    expect(w.engine.statusOf(t)).toBe('done')
    // its answer lost and asked once more: merged, not an error
    expect(await w.engine.merge(t.id, { self: true })).toEqual({ ok: true, note: `${t.id} is merged already` })
  })

  test('Lineclear stopping for an update lets a merge on its way finish and answer first, and starts no new one', async () => {
    const w = world()
    const g = onGitHub()
    const { t } = await started(w, g.dir, 'mergedrain')
    const other = w.engine.add({ project: t.project, title: 'Other', by: 'test' })
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    sh('git add -A && git commit -qm "add hello"', t.worktree!)
    await w.engine.done(t.id, 'Added hello.txt.')
    g.set({ mergeSlow: 1500 })
    const merging = w.engine.merge(t.id, { self: true })
    await until(() => g.gh().calls.some((c) => c.args[0] === 'pr' && c.args[1] === 'view'))
    const drained = w.engine.drain()
    expect(await w.engine.merge(other.id)).toEqual({
      ok: false,
      error: `Lineclear is restarting: nothing was merged. Run lineclear merge ${other.id} again in a minute.`,
    })
    expect(await drained).toBe(true)
    // through by the time it may stop: merged on GitHub and marked so, its answer given
    expect(g.gh().prs[0].state).toBe('MERGED')
    expect(t.merged).toBe(true)
    expect((await merging).ok).toBe(true)
  })

  test("logged in but GitHub doesn't answer: nothing merges, here or there", async () => {
    const w = world()
    const g = onGitHub()
    const { t } = await started(w, g.dir, 'ghdown')
    g.set({ down: true })
    writeFileSync(join(t.worktree!, 'd.txt'), 'd\n')
    sh('git add -A && git commit -qm d', t.worktree!)
    const before = sh('git rev-parse main', g.dir)
    const r = await w.engine.openPr(t.id)
    expect(r.ok).toBe(false)
    expect(r.text).toContain("gh can't reach GitHub")
    const m = await w.engine.merge(t.id, { self: true })
    expect(m.ok).toBe(false)
    expect(m.error).toContain("gh can't reach GitHub now (github.com: Failed to log in")
    expect(sh('git rev-parse main', g.dir)).toBe(before)
    expect(sh('git rev-parse main', g.bare)).toBe(before)
    expect(t.merged).toBeFalsy()
    // its pull request open, and gh logged out here: never merged around it
    g.set({ down: false, authed: false })
    t.pr = { number: 9, url: 'https://github.com/acme/app/pull/9' }
    expect((await w.engine.merge(t.id, { self: true })).error).toContain('PR #9 is on GitHub')
    expect(sh('git rev-parse main', g.dir)).toBe(before)
  })

  test('lineclear pr again pushes to the open one, and readies it once done; a merge GitHub refuses merges nothing', async () => {
    const w = world()
    const g = onGitHub()
    const { t } = await started(w, g.dir, 'ghagain')
    writeFileSync(join(t.worktree!, 'a.txt'), 'a\n')
    sh('git add -A && git commit -qm a', t.worktree!)
    await w.engine.openPr(t.id)
    writeFileSync(join(t.worktree!, 'b.txt'), 'b\n')
    sh('git add -A && git commit -qm b', t.worktree!)
    t.reported = true
    t.said = 'Added a and b.'
    const r = await w.engine.openPr(t.id)
    expect(r.text).toContain('Pushed to PR #1')
    expect(g.gh().prs).toHaveLength(1)
    expect(g.gh().prs[0]).toMatchObject({ isDraft: false })
    expect(g.gh().prs[0].body.startsWith('## What\nAdded a and b.')).toBe(true)
    expect(sh(`git rev-parse refs/heads/${t.branch}`, g.bare)).toBe(sh('git rev-parse HEAD', t.worktree!))
    g.set({ mergeError: 'Pull request #1 is not mergeable: the merge commit cannot be cleanly created.' })
    const m = await w.engine.merge(t.id, { self: true })
    expect(m.ok).toBe(false)
    expect(m.error).toContain('Conflict with main on GitHub')
    expect(t.merged).toBeFalsy()
    expect(g.gh().prs[0].state).toBe('OPEN')
  })

  test('a pull request merged on GitHub by hand: main here catches up and it is marked merged', async () => {
    const w = world()
    const g = onGitHub()
    const { t } = await started(w, g.dir, 'ghhand')
    writeFileSync(join(t.worktree!, 'y.txt'), 'y\n')
    sh('git add -A && git commit -qm y', t.worktree!)
    await w.engine.openPr(t.id)
    const ready = mkdtempSync(join(tmpdir(), 'shep-gh-hand-'))
    g.set({ prs: g.gh().prs.map((p) => ({ ...p, isDraft: false })) })
    sh(`"${join(ghBin, 'gh')}" pr merge 1 --squash`, ready)
    const m = await w.engine.merge(t.id, { self: true })
    expect(m).toEqual({ ok: true, note: 'PR #1 was merged on GitHub already' })
    expect(existsSync(join(g.dir, 'y.txt'))).toBe(true)
  })

  test("main here ahead of GitHub's is refused before anything merges; work main has already closes its pull request", async () => {
    const w = world()
    const g = onGitHub()
    const { t } = await started(w, g.dir, 'ghahead')
    writeFileSync(join(t.worktree!, 'v.txt'), 'v\n')
    sh('git add -A && git commit -qm v', t.worktree!)
    await w.engine.openPr(t.id)
    sh('echo l > local.txt && git add -A && git commit -qm local', g.dir)
    const m = await w.engine.merge(t.id, { self: true })
    expect(m.error).toContain('1 commit GitHub lacks')
    expect(g.gh().prs[0].state).toBe('OPEN')
    // pushed, and the same work landed on main another way: its pull request is closed, the task marked merged
    sh(`git push -q origin main && git merge -q --squash ${t.branch} && git commit -qm "by hand" && git push -q origin main`, g.dir)
    const r = await w.engine.merge(t.id, { self: true })
    expect(r).toEqual({ ok: true, note: 'it was in main already; closed PR #1' })
    expect(g.gh().calls.some((c) => c.args[0] === 'pr' && c.args[1] === 'close')).toBe(true)
  })

  test("a GitHub remote gh isn't logged in to: merged here and main pushed, as before", async () => {
    const w = world()
    const g = onGitHub()
    const { t } = await started(w, g.dir, 'ghnoauth')
    g.set({ authed: false })
    writeFileSync(join(t.worktree!, 'z.txt'), 'z\n')
    sh('git add -A && git commit -qm z', t.worktree!)
    expect((await w.engine.openPr(t.id)).text).toContain('No pull request')
    const m = await w.engine.merge(t.id, { self: true })
    expect(m).toEqual({ ok: true, note: 'pushed main to GitHub' })
    expect(g.gh().prs).toEqual([])
    expect(sh('git log --format=%s -n 1 main', g.bare)).toBe(`${t.id}: Say hello`)
  })

  test('a project that gains its GitHub remote after it was added goes through a pull request', async () => {
    const w = world()
    const g = onGitHub()
    sh('git remote remove origin', g.dir)
    const { p, t } = await started(w, g.dir, 'ghlater')
    expect(p.github).toBeNull()
    sh(`git remote add origin https://github.com/acme/app.git && git fetch -q origin`, g.dir)
    writeFileSync(join(t.worktree!, 'w.txt'), 'w\n')
    sh('git add -A && git commit -qm w', t.worktree!)
    expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
    expect(p.github).toBe('acme/app')
    expect(g.gh().prs[0].state).toBe('MERGED')
  })
})

afterEach(resetMergeSetting)
