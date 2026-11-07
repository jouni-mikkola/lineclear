// A red main holds the merges but its own fix, until a green run clears it: one failure is not followed by more.
import { writeFileSync } from 'node:fs'
import { expect, test } from 'bun:test'
import { repo, sh, started, world } from './engine-world.ts'

type World = ReturnType<typeof world>

const ready = async (w: World, dir: string, name: string) => {
  const { t } = await started(w, dir, name)
  writeFileSync(`${t.worktree}/${name}.txt`, `${name}\n`)
  sh(`git add -A && git commit -qm ${name}`, t.worktree ?? '')
  await w.engine.done(t.id, `Added ${name}.`)
  return t
}

test('three merges on a planted red main: the fix lands, the 2nd and 3rd are held until a green run', async () => {
  const w = world()
  const dir = repo()
  const [fix, second, third] = [await ready(w, dir, 'red-fix'), await ready(w, dir, 'red-two'), await ready(w, dir, 'red-three')]
  fix.by = 'main-green'
  const engine = w.engine as unknown as { data: { red?: Record<string, string> }; redPoll: number }
  engine.redPoll = 20
  engine.data.red = { [dir]: 'bbb2222' }
  const runs = [fix, second, third].map((t) => w.engine.merge(t.id, { self: true }))
  expect((await runs[0]).ok).toBe(true)
  expect(fix.merged).toBe(true)
  expect(second.merged).toBeFalsy()
  expect(third.merged).toBeFalsy()
  // a green run: the watch clears the mark
  delete engine.data.red[dir]
  expect((await runs[1]).ok).toBe(true)
  expect((await runs[2]).ok).toBe(true)
})
