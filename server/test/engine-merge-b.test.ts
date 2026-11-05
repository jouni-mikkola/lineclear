import { resetMergeSetting, onGitHub, ours, waitForChecks } from './engine-merge-fixture.ts'
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sh, repo, world, until, started, G } from './engine-world.ts'

describe('on GitHub: a pull request per task', () => {
  test('its origin is read as written and as git rewrites it: github.com mapped to github.localhost talks to github.localhost', async () => {
    const dir = repo()
    sh('git remote add origin https://github.com/acme/app.git && git config url.http://github.localhost/.insteadOf https://github.com/', dir)
    expect(await G.github(dir)).toEqual({ host: 'github.localhost', repo: 'acme/app' })
    sh('git remote set-url origin http://github.localhost/eliasstravik/shepherdr.git && git config --unset url.http://github.localhost/.insteadOf', dir)
    expect(await G.github(dir)).toEqual({ host: 'github.localhost', repo: 'eliasstravik/shepherdr' })
    sh('git remote set-url origin ssh://git@github.com/acme/app.git', dir)
    expect(await G.github(dir)).toEqual({ host: 'github.com', repo: 'acme/app' })
    sh('git remote set-url origin https://gitlab.com/acme/app.git', dir)
    expect(await G.github(dir)).toBeNull()
  })

  test('a remote-only develop override starts there and merges there, preserving main and the space default', async () => {
    const w = world()
    const g = onGitHub()
    sh('git branch develop main && git push -q origin develop && git branch -D develop', g.dir)
    const main = sh('git rev-parse main', g.dir)
    const p = await w.places.add(g.dir, 'gitflow')
    const t = w.engine.add({ project: p.name, title: 'Develop work', by: 'test', base: 'develop' })
    await until(() => w.started.some((s) => s.key === `${t.id}/Agent`))
    expect(w.started.find((s) => s.key === `${t.id}/Agent`)!.system).toContain('(from develop)')
    expect(w.engine.view(t).base).toBe('develop')
    expect(p.base).toBe('main')
    writeFileSync(join(t.worktree!, 'develop.txt'), 'work')
    sh('git add -A && git commit -qm work', t.worktree!)
    expect((await w.engine.openPr(t.id)).ok).toBe(true)
    expect(g.gh().prs[0].base).toBe('develop')
    expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
    expect(sh('git show develop:develop.txt', g.bare)).toBe('work')
    expect(sh('git rev-parse main', g.bare)).toBe(main)
    expect(sh('git rev-parse develop', g.dir)).toBe(sh('git rev-parse develop', g.bare))
  })

  test('a pull request retargeted on GitHub cannot merge into a different branch', async () => {
    const w = world()
    const g = onGitHub()
    const { t } = await started(w, g.dir, 'wrong-target')
    writeFileSync(join(t.worktree!, 'work.txt'), 'work')
    sh('git add -A && git commit -qm work', t.worktree!)
    expect((await w.engine.openPr(t.id)).ok).toBe(true)
    g.set({ prs: g.gh().prs.map((p) => ({ ...p, base: 'develop' })) })
    const r = await w.engine.merge(t.id, { self: true })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('targets develop')
    expect(g.gh().calls.some((c) => c.args[0] === 'pr' && c.args[1] === 'merge')).toBe(false)
  })

  test('read-only GitHub permission and deleted remote branches refuse work before an agent starts', async () => {
    const w = world()
    const g = onGitHub()
    const p = await w.places.add(g.dir, 'read-only')
    g.set({ permission: 'READ' })
    const t = w.engine.add({ project: p.name, title: 'No write access', by: 'test' })
    await until(() => !!t.trouble)
    expect(t.trouble).toContain('permission')
    expect(t.worktree).toBeUndefined()
    expect(w.started.some((s) => s.key === `${t.id}/Agent`)).toBe(false)
    g.set({ permission: 'WRITE' })
    sh('git branch gone && git push -q origin gone && git push -q origin --delete gone', g.dir)
    const missing = w.engine.add({ project: p.name, title: 'Gone', by: 'test', base: 'gone' })
    await until(() => !!missing.trouble)
    expect(missing.trouble).toContain('Cannot fetch branch gone')
    expect(missing.worktree).toBeUndefined()
  })

  test('lineclear pr opens a draft; done makes it ready with the summary; merge squash-merges it on GitHub and pulls main here', async () => {
    const w = world()
    const g = onGitHub({ remote: 'http://github.localhost/acme/app.git' })
    const { t, key } = await started(w, g.dir, 'gh')
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    sh('git add -A && git commit -qm "add hello"', t.worktree!)
    const r = await w.engine.openPr(t.id)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('Opened PR #1 as a draft')
    expect(r.text).toContain('https://github.com/acme/app/pull/1')
    expect(t.pr).toEqual({ number: 1, url: 'https://github.com/acme/app/pull/1' })
    expect(w.engine.view(t).pr).toEqual(t.pr)
    const pr = g.gh().prs[0]
    expect(pr).toMatchObject({ head: t.branch, base: 'main', title: 'Say hello', isDraft: true })
    expect(pr.body).toContain('> Add hello.txt. Merge when done.')
    expect(pr.body).toContain('Generated with [Claude Code]')
    // gh is told the host git really talks to
    expect(ours(g, t).every((c) => c.host === 'github.localhost')).toBe(true)
    expect(sh(`git rev-parse refs/heads/${t.branch}`, g.bare)).toBe(sh('git rev-parse HEAD', t.worktree!))
    // no checks on this repo: nothing to wait for
    expect((await w.engine.checks(t.id, 0)).text).toContain('no checks')
    await w.engine.done(t.id, 'Added hello.txt.')
    await until(() => !g.gh().prs[0].isDraft)
    expect(g.gh().prs[0].body.startsWith('Added hello.txt.')).toBe(true)
    const m = await w.engine.merge(t.id, { self: true })
    expect(m).toEqual({ ok: true, note: 'merged PR #1 on GitHub, not waiting for its checks' })
    expect(g.gh().prs[0].state).toBe('MERGED')
    expect(sh('git log --format=%s -n 2 main', g.bare).split('\n')).toEqual([`${t.id}: Say hello (#1)`, 'init'])
    // its branch on GitHub is gone, and main here is GitHub's (what Shepherdr's own update watches)
    expect(sh(`git branch --list ${t.branch}`, g.bare)).toBe('')
    expect(sh('git rev-parse main', g.dir)).toBe(sh('git rev-parse main', g.bare))
    expect(existsSync(join(g.dir, 'hello.txt'))).toBe(true)
    expect(w.engine.statusOf(t)).toBe('done')
    w.agentIs(key, 'idle')
    await until(() => !!t.cleaned)
    expect(existsSync(t.worktree!)).toBe(false)
    expect(sh('git branch --list "work/*"', g.dir)).toBe('')
  })

  test('merge opens the pull request itself when the agent never did, and merges it at the commit here', async () => {
    const w = world()
    const g = onGitHub({ checks: [{ name: 'test', bucket: 'pass' }] })
    const { t } = await started(w, g.dir, 'ghmerge')
    // main moved on GitHub since the task started
    const other = mkdtempSync(join(tmpdir(), 'shep-gh-other-'))
    sh(
      `git clone -q ${g.bare} . && git config user.email t@t && git config user.name T && echo o > other.txt && git add -A && git commit -qm other && git push -q origin main`,
      other,
    )
    writeFileSync(join(t.worktree!, 'mine.txt'), 'mine\n')
    w.agentIs(`${t.id}/Agent`, 'idle')
    const m = await w.engine.merge(t.id)
    expect(m.ok).toBe(true)
    const pr = g.gh().prs[0]
    expect(pr).toMatchObject({ number: 1, isDraft: false, state: 'MERGED' })
    expect(g.gh().calls.find((c) => c.args[1] === 'merge')!.args).toContain('--match-head-commit')
    expect(ours(g, t).every((c) => c.host === 'github.com')).toBe(true)
    expect(sh('git log --format=%s -n 3 main', g.dir).split('\n')).toEqual([`${t.id}: Say hello (#1)`, 'other', 'init'])
    expect(sh('git show --name-only --format= main', g.dir)).toBe('mine.txt')
  })

  test('main moved on GitHub without a conflict: merged as it is, its passed checks kept, no new push', async () => {
    const w = world()
    const g = onGitHub({ checks: [{ name: 'test', bucket: 'pass' }] })
    // its brief's Settings block says to wait: set before it is added
    waitForChecks(w)
    const { t } = await started(w, g.dir, 'ghbehind')
    writeFileSync(join(t.worktree!, 'mine.txt'), 'mine\n')
    sh('git add -A && git commit -qm mine', t.worktree!)
    await w.engine.openPr(t.id)
    const head = sh('git rev-parse HEAD', t.worktree!)
    const other = mkdtempSync(join(tmpdir(), 'shep-gh-other-'))
    sh(
      `git clone -q ${g.bare} . && git config user.email t@t && git config user.name T && echo o > other.txt && git add -A && git commit -qm other && git push -q origin main`,
      other,
    )
    const pushes = g.gh().calls.length
    const m = await w.engine.merge(t.id, { self: true })
    expect(m).toEqual({ ok: true, note: 'merged PR #1 on GitHub' })
    // not rebased: GitHub merged the very commit its checks passed on
    expect(sh('git rev-parse HEAD', t.worktree!)).toBe(head)
    const merge = g
      .gh()
      .calls.slice(pushes)
      .find((c) => c.args[1] === 'merge')!.args
    expect(merge[merge.indexOf('--match-head-commit') + 1]).toBe(head)
    expect(sh('git log --format=%s -n 3 main', g.dir).split('\n')).toEqual([`${t.id}: Say hello (#1)`, 'other', 'init'])
    expect(existsSync(join(g.dir, 'other.txt')) && existsSync(join(g.dir, 'mine.txt'))).toBe(true)
  })

  test('a conflict with main is rebased here when git can, pushed, and waits for fresh checks; else it goes back', async () => {
    const w = world()
    const g = onGitHub({ checks: [{ name: 'test', bucket: 'pass' }] })
    waitForChecks(w)
    const { p: place, t } = await started(w, g.dir, 'ghclash')
    writeFileSync(join(t.worktree!, 'README.md'), 'mine\n')
    sh('git add -A && git commit -qm mine', t.worktree!)
    await w.engine.openPr(t.id)
    const head = sh('git rev-parse HEAD', t.worktree!)
    // main took this very change, then changed the line again: merging conflicts, but a rebase drops the change it has
    const other = mkdtempSync(join(tmpdir(), 'shep-gh-other-'))
    sh(
      `git clone -q ${g.bare} . && git config user.email t@t && git config user.name T && git fetch -q origin ${t.branch} && git cherry-pick -x FETCH_HEAD >/dev/null && echo again > README.md && git commit -qam again && git push -q origin main`,
      other,
    )
    writeFileSync(join(t.worktree!, 'new.txt'), 'new\n')
    sh('git add -A && git commit -qm new', t.worktree!)
    g.set({ checks: [{ name: 'test', bucket: 'pending' }] })
    const p = await w.engine.merge(t.id, { self: true })
    expect(p.ok).toBe(false)
    expect(p.error).toContain('rebased on main for a conflict')
    expect(sh('git log --format=%s -n 4 HEAD', t.worktree!).split('\n')).toEqual(['new', 'again', 'mine', 'init'])
    expect(sh(`git rev-parse refs/heads/${t.branch}`, g.bare)).not.toBe(head)
    expect(sh(`git rev-parse refs/heads/${t.branch}`, g.bare)).toBe(sh('git rev-parse HEAD', t.worktree!))
    g.set({ checks: [{ name: 'test', bucket: 'pass' }] })
    expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
    // the same lines changed on both sides: git can't rebase it, so its agent does, by hand
    const u = w.engine.add({ project: place.name, title: 'Say it too', desc: 'Change README.md.', by: 'test' })
    await until(() => w.started.some((s) => s.key === `${u.id}/Agent`))
    writeFileSync(join(u.worktree!, 'README.md'), 'mine too\n')
    sh('git add -A && git commit -qm mine', u.worktree!)
    await w.engine.openPr(u.id)
    const at = sh('git rev-parse HEAD', u.worktree!)
    sh('git pull -q --rebase origin main && echo theirs > README.md && git commit -qam theirs && git push -q origin main', other)
    const c = await w.engine.merge(u.id, { self: true })
    expect(c.ok).toBe(false)
    expect(c.error).toContain('Conflict with main: rebase')
    expect(sh('git rev-parse HEAD', u.worktree!)).toBe(at)
    expect(g.gh().prs[1].state).toBe('OPEN')
  })

  test("failed checks go back to the agent; merging waits while they run, and never on what it can't read", async () => {
    const w = world()
    const g = onGitHub({
      checks: [
        { name: 'test', bucket: 'fail', link: 'https://github.com/acme/app/actions/runs/7' },
        { name: 'lint', bucket: 'pass' },
      ],
    })
    waitForChecks(w)
    const { t, key } = await started(w, g.dir, 'ghfail')
    writeFileSync(join(t.worktree!, 'x.txt'), 'x\n')
    sh('git add -A && git commit -qm x', t.worktree!)
    await w.engine.openPr(t.id)
    const c = await w.engine.checks(t.id, 0)
    expect(c.ok).toBe(false)
    expect(c.text).toContain("GitHub's checks failed on PR #1: test.")
    expect(c.text).toContain('actions/runs/7')
    await w.engine.done(t.id, 'x')
    w.agentIs(key, 'idle')
    // you (or a coordinator) merge: refused, and the agent is told what to fix
    const m = await w.engine.merge(t.id)
    expect(m.ok).toBe(false)
    expect(m.error).toContain('Sent back')
    expect(w.sent.at(-1)!.key).toBe(key)
    expect(w.sent.at(-1)!.text).toContain(`lineclear pr ${t.id}`)
    expect(w.engine.statusOf(t)).toBe('work')
    expect(g.gh().prs[0].state).toBe('OPEN')
    // still running: wait for them
    g.set({ checks: [{ name: 'test', bucket: 'pending' }] })
    const p = await w.engine.merge(t.id, { self: true })
    expect(p.error).toContain(`lineclear checks ${t.id}`)
    expect((await w.engine.checks(t.id, 0)).text).toContain('still run')
    // fixed and passed
    g.set({ checks: [{ name: 'test', bucket: 'pass' }] })
    expect((await w.engine.checks(t.id, 0)).text).toContain('checks passed on PR #1')
    expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
    expect(t.merged).toBe(true)
  })

  // fails on ebb17d5 too; L20 fixes it

  test.skip('Merging, not Ready, from its first merge until it is in: checks running, a rebase, the merge itself', async () => {
    const w = world()
    const g = onGitHub({ checks: [{ name: 'test', bucket: 'pending' }] })
    waitForChecks(w)
    // the checks of its last pull requests took 2, 3 and 9 minutes
    const run = (m: number) => ['2026-10-26T10:00:00Z', `2026-10-26T10:0${m}:00Z`]
    g.set({ api: { 'repos/acme/app/actions/runs': [run(2), run(9), run(3)] } })
    const { t, key } = await started(w, g.dir, 'lands')
    writeFileSync(join(t.worktree!, 'x.txt'), 'x\n')
    sh('git add -A && git commit -qm x', t.worktree!)
    await w.engine.done(t.id, 'Added x, a long summary that belongs in the chat card and never on the row.')
    w.chat.reply = 'Merging once the checks pass.'
    // reported ready, not yet merging: Ready, a few words on its row
    w.agentIs(key, 'idle')
    expect(w.engine.statusOf(t)).toBe('ready')
    expect(w.engine.subOf(t)).toBe('Ready to merge')
    w.agentIs(key, 'working')
    const r = await w.engine.merge(t.id, { self: true })
    expect(r.error).toContain(`lineclear checks ${t.id}`)
    expect(w.engine.statusOf(t)).toBe('merging')
    expect(w.engine.subOf(t)).toBe('Checks running · ~3m')
    expect(w.engine.view(t)).toMatchObject({ status: 'merging', state: expect.stringMatching(/^Merging · /) })
    // its turn ends while it waits for them: still Merging, nothing for you
    w.agentIs(key, 'idle')
    expect(w.engine.statusOf(t)).toBe('merging')
    // a question in its words alone is no fact: still Merging
    w.chat.reply = 'Merge it anyway?'
    expect(w.engine.statusOf(t)).toBe('merging')
    // it asks you on a card meanwhile: Ready, as it waits for you
    w.chat.card = 'ask'
    expect(w.engine.statusOf(t)).toBe('ready')
    w.chat.card = undefined
    w.chat.reply = 'Merging once the checks pass.'
    // the checks pass while it rests with nothing running to wake it: it is told once to merge
    g.set({ checks: [{ name: 'test', bucket: 'pass' }] })
    await w.engine.watchPrs()
    expect(w.sent.at(-1)!.text).toContain(`merge ${t.id} now (lineclear merge ${t.id})`)
    const told = w.sent.length
    await w.engine.watchPrs()
    expect(w.sent.length).toBe(told)
    expect(w.engine.statusOf(t)).toBe('merging')
    // a message from you: back at work, no longer merging
    w.engine.youWrote(key)
    expect(t.landing).toBeUndefined()
    await w.engine.done(t.id, 'x')
    w.agentIs(key, 'working')
    expect((await w.engine.merge(t.id, { self: true })).error).toBeUndefined()
    expect(w.engine.statusOf(t)).toBe('done')
    expect(w.engine.subOf(t)).toBe('Merged')
  })

  test('failed checks on its way in: back at work, not Merging', async () => {
    const w = world()
    const g = onGitHub({ checks: [{ name: 'test', bucket: 'pending' }] })
    waitForChecks(w)
    const { t, key } = await started(w, g.dir, 'landfail')
    writeFileSync(join(t.worktree!, 'x.txt'), 'x\n')
    sh('git add -A && git commit -qm x', t.worktree!)
    await w.engine.done(t.id, 'x')
    w.agentIs(key, 'working')
    await w.engine.merge(t.id, { self: true })
    expect(w.engine.subOf(t)).toBe('Checks running')
    g.set({ checks: [{ name: 'test', bucket: 'fail' }] })
    expect((await w.engine.checks(t.id, 0)).ok).toBe(false)
    expect(t.landing).toBeUndefined()
    expect(w.engine.statusOf(t)).toBe('work')
  })

  test("a token that can't read GitHub's checks reads the Actions jobs of the pull request's commit instead", async () => {
    const w = world()
    const g = onGitHub()
    const { t, key } = await started(w, g.dir, 'ghjobs')
    writeFileSync(join(t.worktree!, 'x.txt'), 'x\n')
    sh('git add -A && git commit -qm x', t.worktree!)
    await w.engine.openPr(t.id)
    const head = sh('git rev-parse HEAD', t.worktree!)
    const job = (status: string, conclusion: string | null) => ({
      name: 'check',
      status,
      conclusion,
      html_url: 'https://github.com/acme/app/actions/runs/7/job/9',
    })
    g.set({ noChecks: true, api: { 'repos/acme/app/actions/runs': [7], 'repos/acme/app/actions/runs/7/jobs': [job('in_progress', null)] } })
    expect((await w.engine.checks(t.id, 0)).text).toContain('still run')
    expect(g.gh().calls.some((c) => c.args.includes(`repos/acme/app/actions/runs?head_sha=${head}&per_page=100`))).toBe(true)
    // reported done while they run: a failure is news, with the end of its log
    await w.engine.done(t.id, 'x')
    g.set({
      api: { 'repos/acme/app/actions/runs': [7], 'repos/acme/app/actions/runs/7/jobs': [job('completed', 'failure')] },
      logs: { '9': '2026-10-26T10:00:00.1Z ##[error]boom' },
    })
    w.agentIs(key, 'idle')
    await w.engine.watchPrs()
    expect(w.sent.at(-1)!.text).toContain('- Check failed: check (https://github.com/acme/app/actions/runs/7/job/9). Its log ends:\n    ##[error]boom')
    const c = await w.engine.checks(t.id, 0)
    expect(c.ok).toBe(false)
    expect(c.text).toContain("GitHub's checks failed on PR #1: check.")
    // fixed: passed, a skipped job aside, and it merges
    g.set({
      api: {
        'repos/acme/app/actions/runs': [7],
        'repos/acme/app/actions/runs/7/jobs': [job('completed', 'success'), { ...job('completed', 'skipped'), name: 'deploy' }],
      },
    })
    expect((await w.engine.checks(t.id, 0)).text).toContain('checks passed on PR #1 (1)')
    await w.engine.done(t.id, 'x')
    expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
  })
})

afterEach(resetMergeSetting)
