// A task's worktree is made and removed by git alone: nothing here has a herdr to ask, and a done task's folder goes.
import { describe, expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { repo } from './engine-world.ts'
import { Worktrees } from '../server/live/engine/worktrees.ts'

const git = (cwd: string, cmd: string) => execSync(`git ${cmd}`, { cwd, encoding: 'utf8' }).trim()

describe('worktrees without herdr', () => {
  test('a worktree is made by git, and put away with its branch once its work is in base', async () => {
    const dir = repo()
    const wt = new Worktrees()
    const at = join(dir, '..', `wt-${Date.now()}`)
    const made = await wt.create({ repo: dir, install: 'true' }, 'work/9-x', 'main', at)
    expect(existsSync(made.path)).toBe(true)
    let closed = false
    const r = await wt.putAway({ repo: dir, wt: made.path, branch: 'work/9-x', base: 'main', closeAgent: async () => void (closed = true) })
    expect(r.kept).toEqual([])
    expect(closed).toBe(true)
    expect(existsSync(made.path)).toBe(false)
    expect(git(dir, 'branch --list work/9-x')).toBe('')
  })

  test('uncommitted work is kept, and said', async () => {
    const dir = repo()
    const wt = new Worktrees()
    const made = await wt.create({ repo: dir, install: 'true' }, 'work/10-x', 'main', join(dir, '..', `wt-${Date.now()}-b`))
    writeFileSync(join(made.path, 'new.txt'), 'x\n')
    const r = await wt.putAway({ repo: dir, wt: made.path, branch: 'work/10-x', base: 'main', closeAgent: async () => undefined })
    expect(r.kept[0]).toContain('uncommitted changes')
    expect(existsSync(made.path)).toBe(true)
  })
})
