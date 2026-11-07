import { resetMergeSetting, ghBin, onGitHub } from './engine-merge-fixture.ts'
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sh, repo, world, until, started } from './engine-world.ts'

describe('known faults of the base', () => {
  test('a branch with conflict markers in it is refused, naming the files; once solved it merges', async () => {
    const w = world()
    const dir = repo()
    const { t } = await started(w, dir, 'markers')
    const marked = '# Title\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> abc1234 (their change)\n'
    writeFileSync(join(t.worktree!, 'notes.md'), marked)
    // left uncommitted too: the merge commits what the agent left
    await w.engine.done(t.id, 'Added notes.')
    const r = await w.engine.merge(t.id, { self: true })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('notes.md still has conflict markers')
    expect(sh('git log --format=%s -n 1', dir)).toBe('init')
    expect(existsSync(join(dir, 'notes.md'))).toBe(false)
    writeFileSync(join(t.worktree!, 'notes.md'), '# Title\nours and theirs\n')
    sh('git add -A && git commit -qm solved', t.worktree!)
    expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
    expect(readFileSync(join(dir, 'notes.md'), 'utf8')).toBe('# Title\nours and theirs\n')
  })

  test('a pull request merged on GitHub by hand marks its task merged by itself, and those queued after it go', async () => {
    const w = world()
    const g = onGitHub()
    const { t, p, key } = await started(w, g.dir, 'ghwatch')
    const b = w.engine.add({ project: p.name, title: 'Second', desc: 'Add b.txt.', by: 'test', after: [t.id] })
    await until(() => w.started.some((s) => s.key === `${b.id}/Agent`))
    writeFileSync(join(t.worktree!, 'y.txt'), 'y\n')
    sh('git add -A && git commit -qm y', t.worktree!)
    await w.engine.openPr(t.id)
    await w.engine.done(t.id, 'Added y.txt.')
    // done marks it ready in the background: once it has, it is merged by hand
    await until(() => !g.gh().prs[0].isDraft)
    sh(`"${join(ghBin, 'gh')}" pr merge 1 --squash`, mkdtempSync(join(tmpdir(), 'shep-gh-hand-')))
    w.agentIs(key, 'idle')
    await w.engine.watchPrs()
    expect(t.merged).toBe(true)
    expect(existsSync(join(g.dir, 'y.txt'))).toBe(true)
    expect(w.sent.some((s) => s.key === `${b.id}/Agent` && s.text.includes(`Go: ${t.id} is done`))).toBe(true)
  })
})

afterEach(resetMergeSetting)
