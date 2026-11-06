// Setting check.where = github: the merge opens or updates the pull request and waits for GitHub's checks instead of
// running the project's full check here, and names the failing tests from the job log. Local runs the check here.
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onGitHub, ours } from './engine-merge-fixture.ts'
import { Settings, sh, started, world } from './engine-world.ts'

const was = process.env.LINECLEAR_CONFIG
afterEach(() => {
  new Settings().set('check.where', null)
  if (was === undefined) delete process.env.LINECLEAR_CONFIG
  else process.env.LINECLEAR_CONFIG = was
})

/** a Lineclear project for this repo whose full check leaves a mark file beside its task folders when it runs */
function projectWithCheck(dir: string) {
  const config = mkdtempSync(join(tmpdir(), 'where-config-'))
  mkdirSync(join(config, 'projects', 'where'), { recursive: true })
  writeFileSync(join(config, 'projects', 'where', 'settings.json'), JSON.stringify({ repo: dir, space: 'x', check: 'touch ../local-check-ran', models: {} }))
  process.env.LINECLEAR_CONFIG = config
}

async function readyTask(w: ReturnType<typeof world>, g: ReturnType<typeof onGitHub>, name: string) {
  projectWithCheck(g.dir)
  const { t, key } = await started(w, g.dir, name)
  writeFileSync(join(t.worktree!, 'x.txt'), 'x\n')
  sh('git add -A && git commit -qm x', t.worktree!)
  await w.engine.done(t.id, 'x')
  w.agentIs(key, 'idle')
  return t
}

const marked = (t: { worktree?: string }) => existsSync(join(t.worktree!, '..', 'local-check-ran'))

describe('check.where', () => {
  test('github: no local full check, the pull request is opened, failing tests come from the job log, a pass merges', async () => {
    const w = world()
    const g = onGitHub({ checks: [{ name: 'check (2/4)', bucket: 'fail', link: 'https://github.com/acme/app/actions/runs/7/job/9' }] })
    g.set({ logs: { '9': 'test/a.test.ts:\n(fail) adds the thing [1.00ms]\n##[error]Process completed with exit code 1.' } })
    w.settings.set('check.where', 'github')
    const t = await readyTask(w, g, 'where-gh')
    const m = await w.engine.merge(t.id)
    expect(m.ok).toBe(false)
    expect(m.error).toContain("GitHub's checks failed on PR #1: check (2/4).")
    expect(m.error).toContain('Failing tests: ')
    expect(m.error).toContain('adds the thing')
    expect(g.gh().prs).toHaveLength(1)
    expect(ours(g, t).some((c) => c.args[0] === 'pr' && c.args[1] === 'checks')).toBe(true)
    expect(marked(t)).toBe(false)
    g.set({ checks: [{ name: 'check (2/4)', bucket: 'pass' }] })
    expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
    expect(g.gh().prs[0].state).toBe('MERGED')
    expect(marked(t)).toBe(false)
  })

  test('local (the default): the full check runs here', async () => {
    const w = world()
    const g = onGitHub()
    const t = await readyTask(w, g, 'where-local')
    expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
    expect(marked(t)).toBe(true)
  })

  test('github with a GitHub gh cannot use refuses and merges nothing', async () => {
    const w = world()
    const g = onGitHub()
    w.settings.set('check.where', 'github')
    const t = await readyTask(w, g, 'where-nogh')
    g.set({ authed: false })
    const m = await w.engine.merge(t.id, { self: true })
    expect(m.ok).toBe(false)
    expect(m.error).toContain('Full check runs is github')
    expect(t.merged).toBeFalsy()
  })
})
