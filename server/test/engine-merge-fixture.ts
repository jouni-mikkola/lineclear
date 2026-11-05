import { expect } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sh, repo, type world, Settings } from './engine-world.ts'
import type { FakeGitHub } from './fake-gh.ts'

/** a GitHub stand-in: a bare repo is GitHub, gh is test/fake-gh.ts; the clone's origin reads as GitHub's */
export const ghBin = mkdtempSync(join(tmpdir(), 'shep-ghbin-'))
writeFileSync(join(ghBin, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dir, 'fake-gh.ts')}" "$@"\n`, { mode: 0o755 })

export function onGitHub(o: { authed?: boolean; down?: boolean; checks?: FakeGitHub['checks']; remote?: string } = {}) {
  process.env.PATH = `${ghBin}:${process.env.PATH}`
  const bare = mkdtempSync(join(tmpdir(), 'shep-gh-origin-'))
  sh('git init -q --bare -b main', bare)
  sh(`git push -q ${bare} main`, repo())
  const dir = mkdtempSync(join(tmpdir(), 'shep-gh-clone-'))
  const remote = o.remote ?? 'https://github.com/acme/app.git'
  sh(
    `git clone -q ${bare} . && git config user.email t@t && git config user.name T && git remote set-url origin ${remote} && git config url.${bare}.insteadOf ${remote}`,
    dir,
  )
  const file = join(mkdtempSync(join(tmpdir(), 'shep-gh-state-')), 'github.json')
  writeFileSync(file, JSON.stringify({ origin: bare, repo: 'acme/app', prs: [], calls: [], authed: o.authed, down: o.down, checks: o.checks }))
  process.env.FAKE_GH_STATE = file
  const gh = () => JSON.parse(readFileSync(file, 'utf8')) as FakeGitHub
  const set = (patch: Partial<FakeGitHub>) => writeFileSync(file, JSON.stringify({ ...gh(), ...patch }))
  return { bare, dir, gh, set }
}

/**
 * gh's calls from this test's repo and worktree. The fake's state is the process's: a background call a test before
 * this one left running (on a slow machine it can still be going) may land in it too.
 */
export const ours = (g: ReturnType<typeof onGitHub>, t: { worktree?: string }) => {
  const calls = g.gh().calls.filter((c) => [g.dir, t.worktree!].some((d) => c.cwd === d || c.cwd?.startsWith(`${d}/`)))
  expect(calls.length).toBeGreaterThan(0)
  return calls
}

/** Settings → How tasks work → Merge after GitHub checks, for one test (it is kept on disk: back to its default after) */
export const waitForChecks = (w: ReturnType<typeof world>) => w.settings.set('brief.merge', 'after GitHub checks')
export const resetMergeSetting = () => void new Settings().set('brief.merge', null)
