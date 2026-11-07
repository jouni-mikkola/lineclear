// lineclear merge on a remote that is not GitHub: main goes to origin, where Lineclear reads it
import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repo, sh, started, world } from './engine-world.ts'

test('a remote that is not GitHub gets main pushed after the merge', async () => {
  const w = world()
  const bare = mkdtempSync(join(tmpdir(), 'shep-bare-'))
  sh(`git clone -q --bare ${repo()} .`, bare)
  const dir = mkdtempSync(join(tmpdir(), 'shep-clone-'))
  sh(`git clone -q ${bare} . && git config user.email t@t && git config user.name T`, dir)
  const { t } = await started(w, dir, 'plain')
  const wt = t.worktree ?? ''
  writeFileSync(join(wt, 'p.txt'), 'p\n')
  sh('git add -A && git commit -qm p', wt)
  expect(await w.engine.merge(t.id, { self: true })).toEqual({ ok: true, note: 'pushed main to origin' })
  expect(sh('git log --format=%s -n 1 main', bare)).toBe(`${t.id}: Say hello`)
})
