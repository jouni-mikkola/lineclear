// L494: the engine lands a task at Ready to merge, rebasing a conflict itself; one it cannot settle opens one card.
import { describe, expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sh, repo, world, until, started } from './engine-world.ts'

async function ready(w: ReturnType<typeof world>, dir: string, name: string, file: string, text: string) {
  const { t, key } = await started(w, dir, name)
  writeFileSync(join(t.worktree!, file), text)
  sh(`git add -A && git commit -qm ${name}`, t.worktree!)
  await w.engine.done(t.id, `Added ${file}.`)
  w.agentIs(key, 'idle')
  await until(() => w.engine.statusOf(t) === 'ready')
  return t
}

describe('the engine lands a ready task', () => {
  test('a green task is merged by one look at the board', async () => {
    const w = world()
    const dir = repo()
    const t = await ready(w, dir, 'land-green', 'green.txt', 'green\n')
    await w.engine.landReady()
    await until(() => !!t.merged)
    expect(existsSync(join(dir, 'green.txt'))).toBe(true)
  })

  test('a task behind main is rebased and then merged', async () => {
    const w = world()
    const dir = repo()
    const t = await ready(w, dir, 'land-behind', 'mine.txt', 'mine\n')
    writeFileSync(join(dir, 'other.txt'), 'other\n')
    sh('git add -A && git commit -qm other', dir)
    await w.engine.landReady()
    await until(() => !!t.merged)
    expect(existsSync(join(dir, 'mine.txt')) && existsSync(join(dir, 'other.txt'))).toBe(true)
  })

  test('a conflict the rebase cannot settle opens one card, however often it is looked at', async () => {
    const w = world()
    const dir = repo()
    const t = await ready(w, dir, 'land-clash', 'README.md', 'theirs\n')
    writeFileSync(join(dir, 'README.md'), 'mine\n')
    sh('git commit -qam mine', dir)
    const cards = () => w.posted.filter((p) => p.id === `land:${t.id}`)
    await w.engine.landReady()
    await until(() => cards().length === 1)
    expect(t.merged).toBeFalsy()
    expect(cards()[0].card?.text).toContain('README.md')
    // refused: not tried again at the next look
    t.landTriedAt = undefined
    t.landCard = true
    await w.engine.landReady()
    await Bun.sleep(300)
    expect(cards().length).toBe(1)
  })

  test('a task whose merges ask first is left alone', async () => {
    const w = world()
    const t = await ready(w, repo(), 'land-ask', 'ask.txt', 'ask\n')
    w.settings.set('brief.merge', 'ask me first')
    try {
      await w.engine.landReady()
      await Bun.sleep(300)
      expect(t.merged).toBeFalsy()
    } finally {
      w.settings.set('brief.merge', null)
    }
  })
})
