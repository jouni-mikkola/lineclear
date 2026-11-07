import { repo, sh, started, world } from './engine-world.ts'
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as G from '../server/live/engine/git.ts'

test('a command in a folder that was removed fails naming the folder, never as a missing git', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lineclear-gone-'))
  rmSync(dir, { recursive: true })
  const r = await G.git(dir, 'status')
  expect(r.ok).toBe(false)
  expect(r.err).toBe(`the folder ${dir} is gone`)
})

test('a merge whose task folder was removed between two tries says which folder is gone', async () => {
  const w = world()
  const dir = repo()
  const { t } = await started(w, dir, 'gone')
  const worktree = t.worktree ?? ''
  writeFileSync(join(worktree, 'x.txt'), 'x\n')
  sh('git add -A && git commit -qm x', worktree)
  rmSync(worktree, { recursive: true })
  const r = await w.engine.merge(t.id, { self: true })
  expect(r.ok).toBe(false)
  expect(r.error).toContain(`the folder ${worktree} is gone`)
})

test('conflict markers are found by exit code and null-separated paths, the same under a Finnish locale', async () => {
  const dir = repo()
  sh('git checkout -qb work', dir)
  writeFileSync(join(dir, 'a b.txt'), 'x\n<<<<<<< HEAD\ny\n')
  writeFileSync(join(dir, 'title.md'), 'Title\n=======\n')
  writeFileSync(join(dir, 'ok.txt'), 'fine\n')
  sh('git add -A && git commit -qm marks', dir)
  const lang = process.env.LANG
  try {
    for (const l of ['C', 'fi_FI.UTF-8']) {
      process.env.LANG = l
      process.env.LC_ALL = l
      expect(await G.conflictMarkers(dir, 'main')).toEqual(['a b.txt'])
    }
  } finally {
    if (lang === undefined) delete process.env.LANG
    else process.env.LANG = lang
    delete process.env.LC_ALL
  }
})
