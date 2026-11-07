// A task's branch keeps its work: "nothing to merge" is refused while it holds commits main lacks, and a worktree that
// is gone (or a branch only origin has) is made again from the branch.
import { expect, setDefaultTimeout, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repo, sh, started, world } from './engine-world.ts'
import { remoteBranch, unmerged } from '../server/live/engine/branch-work.ts'

setDefaultTimeout(60_000)

const commit = (wt: string, file: string) => {
  writeFileSync(join(wt, file), `${file}\n`)
  sh(`git add -A && git commit -qm ${file}`, wt)
}

test('task close is refused while the branch has commits main lacks; the agent is told and the task stays open', async () => {
  const w = world()
  const { t, key } = await started(w, repo(), 'refuses')
  commit(t.worktree as string, 'wip.txt')
  await expect(w.engine.close(t.id)).rejects.toThrow('has 1 commit main lacks')
  expect(w.engine.task(t.id)?.closed).toBeFalsy()
  expect(w.sent.some((s) => s.key === key && s.text.includes('not Done with nothing to merge'))).toBe(true)
})

test('a branch with nothing main lacks still closes', async () => {
  const w = world()
  const { t } = await started(w, repo(), 'closesclean')
  expect(await w.engine.close(t.id)).toEqual({ kept: [] })
})

test('a task whose worktree is gone gets it again from its branch', async () => {
  const w = world()
  const dir = repo()
  const { t } = await started(w, dir, 'remade')
  const wt = t.worktree as string
  commit(wt, 'wip.txt')
  sh(`git worktree remove --force ${wt}`, dir)
  expect(existsSync(wt)).toBe(false)
  await w.engine.resume(t.id)
  expect(readFileSync(join(wt, 'wip.txt'), 'utf8')).toBe('wip.txt\n')
})

test('a branch only origin has is what a new worktree starts from', async () => {
  const dir = repo()
  const origin = mkdtempSync(join(tmpdir(), 'shep-origin-'))
  sh('git checkout -q -b work/1-x && echo x > x.txt && git add -A && git commit -qm x && git checkout -q main', dir)
  sh(`git clone -q --bare . ${origin} && git remote add origin ${origin} && git fetch -q origin && git branch -D work/1-x`, dir)
  expect(await remoteBranch(dir, 'work/1-x')).toBe(sh('git rev-parse origin/work/1-x', dir))
  sh('git branch work/1-x FETCH_HEAD', dir)
  expect(await remoteBranch(dir, 'work/1-x')).toBeUndefined()
  expect(await unmerged(dir, 'work/1-x', 'main', 'LIN-1')).toBe(1)
})

test('a squash-merged branch is not unmerged work, and task close --force closes one that is', async () => {
  const w = world()
  const dir = repo()
  const { t } = await started(w, dir, 'squashed')
  const wt = t.worktree as string
  commit(wt, 'a.txt')
  commit(wt, 'b.txt')
  sh(`git merge --squash ${t.branch} && git commit -qm "${t.id}: squashed"`, dir)
  expect(await unmerged(dir, t.branch as string, 'main', t.id)).toBe(0)
  const other = await started(w, dir, 'forced')
  commit(other.t.worktree as string, 'c.txt')
  const { kept } = await w.engine.close(other.t.id, undefined, undefined, true)
  expect(kept).toHaveLength(1)
})
