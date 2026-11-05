import { expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sh, repo, world, until, fakeHerdr } from './engine-world.ts'
import { seedModels } from './model-fixture.ts'
import { Worktrees } from '../server/live/engine/worktrees.ts'
import type { BoxInfo } from '../server/live/box.ts'

seedModels()

// A second herdr session stands for another machine: its own socket, its own worktree keeper. One engine, one store.
const vm: BoxInfo = {
  label: 'vm2',
  target: 'vm2',
  home: tmpdir(),
  path: process.env.PATH ?? '',
  herdr: 'herdr',
  session: 'vm2',
  os: 'Linux',
  socket: '/tmp/vm2.sock',
}

test('a task on another machine starts there, is reviewed and merged by the one server, with one id series and one store', async () => {
  const w = world()
  const there = fakeHerdr()
  w.engine.addMachine(vm, new Worktrees(there.h as never))
  const dir = repo()
  const p = await w.places.add(dir, 'one-server')
  const local = w.engine.add({ project: p.name, title: 'Here', desc: 'x', by: 'test' })
  const far = w.engine.add({ project: p.name, title: 'There', desc: 'y', by: 'test', machine: 'vm2' })
  // one series per space, whichever machine a task is on
  expect([local.n, far.n]).toEqual([1, 2])
  expect(far.id.split('-')[0]).toBe(local.id.split('-')[0])
  expect(far.machine).toBe('vm2')
  expect(w.engine.view(far).machine).toBe('vm2')
  await until(() => !!far.worktree && w.started.some((s) => s.key === `${far.id}/Agent`))
  // its workspace was made through that machine's herdr, not the server's
  expect((await there.h.workspaces()).some((s) => s.worktree?.checkout_path === far.worktree)).toBe(true)
  expect((await w.herdr.h.workspaces()).some((s) => s.worktree?.checkout_path === far.worktree)).toBe(false)
  writeFileSync(join(far.worktree!, 'there.txt'), 'there\n')
  sh('git add -A && git commit -qm "add there"', far.worktree!)
  await w.engine.done(far.id, 'Added there.txt.')
  const r = await w.engine.merge(far.id, { self: true })
  expect(r.ok).toBe(true)
  expect(existsSync(join(dir, 'there.txt'))).toBe(true)
  expect(w.engine.statusOf(far)).toBe('done')
  // one store holds both
  expect(w.engine.tasks.map((t) => t.id).sort()).toEqual([local.id, far.id].sort())
})
