import { describe, expect, test } from 'bun:test'
import * as GH from '../server/live/engine/github.ts'
import { RepoWatch } from '../server/live/engine/repo-watch.ts'
import { onGitHub } from './engine-merge-fixture.ts'
import { world } from './engine-world.ts'

const g: GH.GitHub = { repo: 'acme/app', host: 'github.com' }
const calls = (gh: ReturnType<typeof onGitHub>) => gh.gh().calls.length

describe('GitHub is read once per repo', () => {
  test('45 open pull requests are one gh call, and asking again meanwhile or soon after is none', async () => {
    world()
    const gh = onGitHub({ checks: [{ name: 'test', bucket: 'pass' }] })
    gh.set({
      prs: Array.from({ length: 45 }, (_, i) => ({ number: i + 1, head: `b${i}`, base: 'main', title: 't', body: '', isDraft: false, state: 'OPEN' as const })),
    })
    const repos = new RepoWatch()
    const before = calls(gh)
    const reads = await Promise.all(Array.from({ length: 45 }, () => repos.read(g, gh.dir, 0)))
    expect(calls(gh) - before).toBe(1)
    expect(reads[0].prs.size).toBe(45)
    expect(reads[0].prs.get(7)?.checks?.state).toBe('pass')
    await repos.read(g, gh.dir, 60_000)
    expect(calls(gh) - before).toBe(1)
  })

  test('waiting for checks reads the repo once however many wait', async () => {
    world()
    const gh = onGitHub({ checks: [{ name: 'test', bucket: 'pending' }] })
    gh.set({ prs: [{ number: 1, head: 'b', base: 'main', title: 't', body: '', isDraft: false, state: 'OPEN' }] })
    const repos = new RepoWatch()
    const head = (await repos.read(g, gh.dir, 0)).prs.get(1)!.pr.headRefOid
    const before = calls(gh)
    const states = await Promise.all(Array.from({ length: 45 }, () => repos.checks(g, gh.dir, 1, head, 60_000)))
    expect(states.every((c) => c?.state === 'pending')).toBe(true)
    expect(calls(gh) - before).toBe(0)
  })

  test('a malformed answer makes the repo down and is never "no pull request"', async () => {
    world()
    const gh = onGitHub()
    gh.set({ badGraphql: true })
    const repos = new RepoWatch()
    await expect(repos.read(g, gh.dir, 0)).rejects.toBeInstanceOf(GH.GhDown)
    expect(repos.state(GH.repoKey(g)).state).toBe('down')
    gh.set({ badGraphql: false })
    await repos.read(g, gh.dir, 0)
    expect(repos.state(GH.repoKey(g)).state).toBe('ok')
  })
})
