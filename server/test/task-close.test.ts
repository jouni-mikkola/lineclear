import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { onGitHub } from './engine-merge-fixture.ts'
import { sh, world, started } from './engine-world.ts'

const heads = (dir: string) => sh('git branch --list "work/*" --format="%(refname:short)"', dir)
const remoteHeads = (bare: string) => sh('git branch --list --format="%(refname:short)"', bare)

async function withPr(slug: string) {
  const w = world()
  const g = onGitHub()
  const { t } = await started(w, g.dir, slug)
  writeFileSync(join(t.worktree!, 'y.txt'), 'y\n')
  sh('git add -A && git commit -qm y', t.worktree!)
  await w.engine.openPr(t.id)
  return { w, g, t }
}

describe('a closed task closes its pull request', () => {
  test('close closes the open PR and deletes its remote and local branch, once', async () => {
    const { w, g, t } = await withPr('closepr')
    expect(g.gh().prs[0].state).toBe('OPEN')
    expect(remoteHeads(g.bare)).toContain(t.branch!)
    // main has the work (merged another way), so the task has nothing left to merge
    sh(`git merge -q --ff-only ${t.branch} && git push -q origin main`, g.dir)
    expect(await w.engine.close(t.id)).toEqual({ kept: [] })
    expect(g.gh().prs[0].state).toBe('CLOSED')
    expect(remoteHeads(g.bare)).not.toContain(t.branch!)
    expect(heads(g.dir)).toBe('')
    expect(t.prDropped).toBe(true)
    const calls = g.gh().calls.length
    await w.engine.sweep()
    expect(g.gh().calls.length).toBe(calls)
  })

  test('a task with unmerged work keeps its PR and branches as today', async () => {
    const { w, g, t } = await withPr('closekept')
    const { kept } = await w.engine.close(t.id, 'Not needed.', undefined, true)
    expect(kept.length).toBe(1)
    expect(g.gh().prs[0].state).toBe('OPEN')
    expect(remoteHeads(g.bare)).toContain(t.branch!)
    expect(heads(g.dir)).toBe(t.branch!)
    expect(t.prDropped).toBeUndefined()
  })

  test('the sweep closes the open PR of a Done task closed before', async () => {
    const { w, g, t } = await withPr('closesweep')
    sh(`git merge -q --ff-only ${t.branch} && git push -q origin main`, g.dir)
    await w.engine.close(t.id)
    t.prDropped = undefined
    g.set({ prs: g.gh().prs.map((p) => ({ ...p, state: 'OPEN' })) })
    await w.engine.sweep()
    expect(g.gh().prs[0].state).toBe('CLOSED')
    expect(w.engine.task(t.id)?.prDropped).toBe(true)
  })
})
