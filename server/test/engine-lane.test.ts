// The merge lane on a real git repo (engine-world.ts): the project's full check runs once on the merged result, whether
// or not main touched the branch's files.
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWork } from '../../src/task-work.ts'
import * as Lane from '../server/live/engine/lane.ts'
import { repo, sh, started, until, world } from './engine-world.ts'

const was = process.env.LINECLEAR_CONFIG
afterEach(() => {
  if (was === undefined) delete process.env.LINECLEAR_CONFIG
  else process.env.LINECLEAR_CONFIG = was
})
/** a Lineclear project for this repo whose check logs a run and fails when fail.txt is there */
const project = (dir: string, check = 'echo ran >> ../ran.log; if [ -e fail.txt ]; then echo the check said no; exit 1; fi') => {
  const config = mkdtempSync(join(tmpdir(), 'lane-config-'))
  mkdirSync(join(config, 'projects', 'lane'), { recursive: true })
  writeFileSync(join(config, 'projects', 'lane', 'settings.json'), JSON.stringify({ repo: dir, space: 'x', check, models: {} }))
  process.env.LINECLEAR_CONFIG = config
}
const wt = (t: { worktree?: string }) => t.worktree ?? ''

test('a conflict names the files and goes back to the agent', async () => {
  const w = world()
  const dir = repo()
  project(dir)
  const { t } = await started(w, dir, 'lane-clash')
  writeFileSync(join(wt(t), 'README.md'), 'theirs\n')
  sh('git commit -qam theirs', wt(t))
  writeFileSync(join(dir, 'README.md'), 'mine\n')
  sh('git commit -qam mine', dir)
  await w.engine.done(t.id, 'Changed README.')
  w.agentIs(`${t.id}/Agent`, 'idle')
  const r = await w.engine.merge(t.id)
  expect(r.ok).toBe(false)
  expect(r.error).toContain('Conflicting files: README.md')
  expect(w.sent.some((m) => m.text.includes('Conflicting files: README.md'))).toBe(true)
  expect(t.merged).toBeFalsy()
})

/** a Lineclear-shaped repo: its smoke check answers with `exit` (a stand-in for a service that starts or not) */
async function lineclearRepo(name: string, exit: number) {
  const w = world()
  const dir = repo()
  mkdirSync(join(dir, 'scripts'))
  mkdirSync(join(dir, 'bin'))
  writeFileSync(join(dir, 'scripts', 'smoke.ts'), `console.log(${JSON.stringify('the web pages do not answer')}); process.exit(${exit})\n`)
  writeFileSync(join(dir, 'bin', 'lineclear'), '#!/bin/sh\n')
  sh('git add -A && git commit -qm smoke', dir)
  const { t } = await started(w, dir, name)
  writeFileSync(join(wt(t), 'mine.txt'), 'mine\n')
  sh('git add -A && git commit -qm mine', wt(t))
  await w.engine.done(t.id, 'Added mine.')
  return { w, dir, t }
}

test('a branch of Lineclear whose service does not start is not merged, and the failed check is named', async () => {
  const { w, dir, t } = await lineclearRepo('lane-smoke-fail', 1)
  const before = sh('git rev-parse HEAD', dir)
  const r = await w.engine.merge(t.id, { self: true })
  expect(r.ok).toBe(false)
  expect(r.error).toContain('does not start as a service')
  expect(r.error).toContain('the web pages do not answer')
  expect(sh('git rev-parse HEAD', dir)).toBe(before)
  expect(t.merged).toBeFalsy()
})

test('a branch of Lineclear whose service starts is merged', async () => {
  const { w, t } = await lineclearRepo('lane-smoke-pass', 0)
  expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
})

test('an error of a merge whose caller left goes to the agent, once', async () => {
  const sent: string[] = []
  const send = async (m: string) => void sent.push(m)
  await Lane.tellIfLeft(true, { ok: false, error: 'Merge failed: x' }, send)
  await Lane.tellIfLeft(true, { ok: false, error: 'Conflict. Sent back to LIN-1 to fix.' }, send)
  await Lane.tellIfLeft(false, { ok: false, error: 'Merge failed: y' }, send)
  await Lane.tellIfLeft(true, { ok: true }, send)
  expect(sent).toEqual(['Merge failed: x'])
})

test('a task started on machine B has its agent recorded as run on B, none on the main machine', async () => {
  const w = world()
  const dir = repo()
  project(dir, 'true')
  const p = await w.places.add(dir, 'lane-agent-b')
  const t = w.engine.add({ project: p.name, title: 'Say hello', desc: 'Add hello.txt.', by: 'test', machine: 'boxb' })
  await until(() => w.started.some((s) => s.key === `${t.id}/Agent`))
  const lines = readWork().filter((l) => l.step === t.id)
  expect(lines.map((l) => l.work)).toEqual(['agent'])
  expect(lines.every((l) => l.machine === 'boxb')).toBe(true)
})
