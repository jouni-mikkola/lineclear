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
