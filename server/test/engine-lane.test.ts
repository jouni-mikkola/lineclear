// The merge lane on a real git repo (engine-world.ts): the project's full check runs once on the merged result, whether
// or not main touched the branch's files, one full check at a time on the machine.
import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Runs from '../../src/check-runs.ts'
import { checkTier } from '../../src/check-tier.ts'
import { readSettings } from '../../src/project.ts'
import * as Lane from '../server/live/engine/lane.ts'
import * as Queue from '../server/live/engine/check-queue.ts'
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
const ran = (t: { worktree?: string }) => existsSync(join(wt(t), '..', 'ran.log'))
const lines = (first: string, last: string) => `${first}\ntwo\nthree\nfour\nfive\nsix\n${last}\n`

/** a task that changed the last line of a.txt while main changed its first: the lane must check the merged result */
async function sharedEdit(name: string, o: { failOnMain?: boolean } = {}) {
  const w = world()
  const dir = repo()
  project(dir)
  const { t } = await started(w, dir, name)
  writeFileSync(join(dir, 'a.txt'), lines('one', 'seven'))
  sh('git add -A && git commit -qm a', dir)
  sh('git rebase main', wt(t))
  writeFileSync(join(wt(t), 'a.txt'), lines('one', 'seven mine'))
  sh('git commit -qam mine', wt(t))
  writeFileSync(join(dir, 'a.txt'), lines('one first', 'seven'))
  // main can add a file that makes the check fail on the merged result
  if (o.failOnMain) writeFileSync(join(dir, 'fail.txt'), 'x\n')
  sh('git add -A && git commit -qm later', dir)
  await w.engine.done(t.id, 'Changed a.')
  return { w, dir, t }
}

test('main did not touch its files: the full check still runs once, and a pass lets it in', async () => {
  const w = world()
  const dir = repo()
  project(dir)
  const { t } = await started(w, dir, 'lane-alone')
  writeFileSync(join(wt(t), 'mine.txt'), 'mine\n')
  sh('git add -A && git commit -qm mine', wt(t))
  writeFileSync(join(dir, 'other.txt'), 'other\n')
  sh('git add -A && git commit -qm other', dir)
  await w.engine.done(t.id, 'Added mine.')
  expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
  expect(readFileSync(join(wt(t), '..', 'ran.log'), 'utf8')).toBe('ran\n')
})

test('main touched its files: the check runs on the merged result first, and a pass lets it in', async () => {
  const { w, dir, t } = await sharedEdit('lane-pass')
  const r = await w.engine.merge(t.id, { self: true })
  expect(r.ok).toBe(true)
  expect(ran(t)).toBe(true)
  const merged = readFileSync(join(dir, 'a.txt'), 'utf8')
  expect(merged).toContain('one first')
  expect(merged).toContain('seven mine')
})

/** a check run by hand holds the repo's line: it runs, so the lane's turn cannot go before it */
const holdLine = (dir: string) => {
  const line = Queue.lineOf(dir)
  const other = Queue.joinLine('lane', line)
  const file = join(process.env.LINECLEAR_CONFIG ?? join(homedir(), '.config', 'lineclear'), 'check-queue', other)
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), work: process.pid }))
  return { line, other }
}

test('another full check runs in this repo: it waits for the check slot, says so on its line, then goes', async () => {
  const { w, dir, t } = await sharedEdit('lane-queue')
  const { line, other } = holdLine(dir)
  const merging = w.engine.merge(t.id, { self: true })
  await until(() => w.engine.subOf(t) === 'Waits for the check slot · 1 ahead')
  expect(ran(t)).toBe(false)
  Queue.leaveLine(other)
  expect((await merging).ok).toBe(true)
  expect(ran(t)).toBe(true)
  expect(Queue.checkLine(line)).toEqual([])
})

test('back at work while its merge waits for the check slot: its branch and edits are left as they are, nothing merges', async () => {
  const { w, dir, t } = await sharedEdit('lane-left')
  const head = sh('git rev-parse HEAD', wt(t)).trim()
  const { line, other } = holdLine(dir)
  const merging = w.engine.merge(t.id, { self: true })
  await until(() => w.engine.subOf(t) === 'Waits for the check slot · 1 ahead')
  // its agent works on while it waits: an edit not committed yet
  writeFileSync(join(wt(t), 'b.txt'), 'half done\n')
  Queue.leaveLine(other)
  const r = await merging
  expect(r.ok).toBe(false)
  expect(r.error).toContain('went back to work')
  expect(r.error).toContain('its folder has uncommitted changes')
  expect(ran(t)).toBe(false)
  expect(sh('git rev-parse HEAD', wt(t)).trim()).toBe(head)
  expect(readFileSync(join(wt(t), 'b.txt'), 'utf8')).toBe('half done\n')
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).not.toContain('seven mine')
  expect(Queue.checkLine(line)).toEqual([])
})

test('a message to the task while its merge waits for the check slot does not cancel the merge', async () => {
  const { w, dir, t } = await sharedEdit('lane-message')
  const { line, other } = holdLine(dir)
  const merging = w.engine.merge(t.id, { self: true })
  await until(() => w.engine.subOf(t) === 'Waits for the check slot · 1 ahead')
  // a nudge or a routing error reaches the task; its branch and worktree stay as they are
  w.engine.youWrote(`${t.id}/Agent`, { go: false })
  w.engine.youWrote(`${t.id}/Agent`)
  Queue.leaveLine(other)
  const r = await merging
  expect(r.error).toBeUndefined()
  expect(r.ok).toBe(true)
  expect(ran(t)).toBe(true)
  expect(Queue.checkLine(line)).toEqual([])
})

test("a task whose done report never arrived (a worker machine's) merges: the merge makes it ready", async () => {
  const { w, dir, t } = await sharedEdit('lane-unreported')
  t.reported = false
  t.landing = undefined
  const r = await w.engine.merge(t.id, { self: true })
  expect(r.error).toBeUndefined()
  expect(r.ok).toBe(true)
  expect(ran(t)).toBe(true)
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toContain('seven mine')
})

test('a failed check goes back to the agent with its output, and nothing is merged', async () => {
  const { w, dir, t } = await sharedEdit('lane-fail', { failOnMain: true })
  const before = sh('git rev-parse HEAD', dir)
  const r = await w.engine.merge(t.id, { self: true })
  expect(r.ok).toBe(false)
  expect(r.error).toContain('the check said no')
  expect(sh('git rev-parse HEAD', dir)).toBe(before)
  expect(t.merged).toBeFalsy()
  // anyone else asking: the agent is told, and so is the caller
  w.agentIs(`${t.id}/Agent`, 'idle')
  const other = await w.engine.merge(t.id)
  expect(other.error).toContain('Sent back')
  expect(w.sent.some((m) => m.text.includes('the check said no'))).toBe(true)
})

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

test('a self merge that outlasts its deadline still gets its failure in the same call, and the agent is told once', async () => {
  const w = world()
  const dir = repo()
  project(dir, 'sleep 1.5; echo the check said no; exit 1')
  const { t, key } = await started(w, dir, 'lane-late')
  writeFileSync(join(wt(t), 'mine.txt'), 'mine\n')
  sh('git add -A && git commit -qm mine', wt(t))
  await w.engine.done(t.id, 'Added mine.')
  w.engine.mergeDeadline = 300
  const r = await w.engine.merge(t.id, { self: true })
  expect(r.ok).toBe(false)
  expect(r.error).toContain('the check said no')
  expect(w.sent.filter((s) => s.key === key && s.text.includes('the check said no'))).toHaveLength(1)
  expect(t.merged).toBeFalsy()
  expect(w.engine.view(t).mergeStopped).toContain('the check said no')
})

test("a merge behind another one's long check gets its result in one call, however short the deadline", async () => {
  const w = world()
  const dir = repo()
  project(dir, 'sleep 1.5')
  const first = await started(w, dir, 'lane-line-a')
  const second = await started(w, dir, 'lane-line-b')
  for (const [x, f] of [
    [first.t, 'a.txt'],
    [second.t, 'b.txt'],
  ] as const) {
    writeFileSync(join(wt(x), f), `${f}\n`)
    sh(`git add -A && git commit -qm ${f}`, wt(x))
    await w.engine.done(x.id, `Added ${f}.`)
  }
  w.engine.mergeDeadline = 300
  const [a, b] = await Promise.all([w.engine.merge(first.t.id, { self: true }), w.engine.merge(second.t.id, { self: true })])
  expect(a.ok).toBe(true)
  expect(b.ok).toBe(true)
  expect(second.t.merged).toBe(true)
  expect(w.engine.view(second.t).mergeStopped).toBeUndefined()
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

test('a merge cut short by a restart ends as stopped with its reason, not Merging for good', async () => {
  const w = world()
  const dir = repo()
  project(dir)
  const { t } = await started(w, dir, 'lane-restart')
  writeFileSync(join(wt(t), 'mine.txt'), 'mine\n')
  sh('git add -A && git commit -qm mine', wt(t))
  await w.engine.done(t.id, 'Added mine.')
  t.landing = { step: 'check', at: Date.now() }
  w.engine.endLostMerges()
  expect(t.landing).toBeUndefined()
  expect(w.engine.view(t).mergeStopped).toContain('restarted')
})

/** the lane's check on a task's branch with the machine quiet or loaded, the check being `command` */
async function laneCheck(name: string, command: string, load = 0, slotMachine?: string) {
  const w = world()
  const dir = repo()
  project(dir, command)
  const { t } = await started(w, dir, name)
  writeFileSync(join(wt(t), 'mine.txt'), 'mine\n')
  sh('git add -A && git commit -qm mine', wt(t))
  await w.engine.done(t.id, 'Added mine.')
  const c = await Lane.checkInTurn(t.id, dir, wt(t), 'main', command, {
    gone: () => undefined,
    waiting: () => {},
    slotMachine,
    readLoad: () => [load, load, load],
  })
  return { c, runs: Runs.readRuns(dir, 0) }
}

test('a check that times out and then passes is rerun once: the merge goes on and no refusal is counted', async () => {
  const { c, runs } = await laneCheck('lane-rerun-pass', 'if [ -e ../tried ]; then exit 0; fi; touch ../tried; exit 124')
  expect(c.step === 'checked' && c.ok).toBe(true)
  expect(runs.map((r) => r.ok)).toEqual([false, true])
  expect(runs[0]?.rerun).toBe(true)
  expect(Runs.refusedMergeBranches(runs)).toEqual([])
})

test('a check that fails twice with no name is held as unnamed with one refusal', async () => {
  const { c, runs } = await laneCheck('lane-rerun-fail', 'echo killed; exit 1')
  expect(c.step === 'checked' && !c.ok && c.tail).toContain('held, cause unnamed')
  expect(runs).toHaveLength(2)
  expect(Runs.refusedMergeBranches(runs)).toHaveLength(1)
})

test('a check that names a failing test is run once, and a loaded machine does not rerun', async () => {
  expect((await laneCheck('lane-named', 'echo "(fail) a test"; echo " 1 fail"; exit 1')).runs).toHaveLength(1)
  expect((await laneCheck('lane-loaded', 'exit 124', 1e6)).runs).toHaveLength(1)
})

test("a task started on machine B has its merge check recorded on B and waits in B's check line, never the main one", async () => {
  const w = world()
  const dir = repo()
  project(dir, 'true')
  const { t } = await started(w, dir, 'lane-machine-b')
  writeFileSync(join(wt(t), 'mine.txt'), 'mine\n')
  sh('git add -A && git commit -qm mine', wt(t))
  await w.engine.done(t.id, 'Added mine.')
  const config = process.env.LINECLEAR_CONFIG ?? ''
  // no room on B: its one check slot is held
  writeFileSync(join(config, 'machine.json'), JSON.stringify({ checkSlots: 1, loadPerCore: 1e6 }))
  const held = Queue.takeSlots(1, { ...process.env, LINECLEAR_MACHINE: 'boxb' }) ?? []
  expect(held).toHaveLength(1)
  const heard: number[] = []
  const run = Lane.checkInTurn(t.id, dir, wt(t), 'main', 'true', { gone: () => undefined, waiting: (_n, noSlot) => heard.push(noSlot), slotMachine: 'boxb' })
  const line = join(config, 'check-queue', Queue.lineOn(dir, 'boxb'))
  while (!existsSync(line) || !heard.includes(1)) await Bun.sleep(10)
  expect(existsSync(join(config, 'check-queue', Queue.lineOf(dir)))).toBe(false)
  for (const f of held) rmSync(f, { force: true })
  const c = await run
  expect(c.step === 'checked' && c.ok).toBe(true)
  expect(Runs.readRuns(dir, 0).map((r) => r.machine)).toEqual(['boxb'])
})

test("a task started on machine B: its lineclear check and its merge check both run on B, none on the main machine", async () => {
  const w = world()
  const dir = repo()
  project(dir, 'true')
  const { t } = await started(w, dir, 'lane-b-both')
  t.machine = 'boxb'
  writeFileSync(join(wt(t), 'mine.txt'), 'mine\n')
  sh('git add -A && git commit -qm mine', wt(t))
  await w.engine.done(t.id, 'Added mine.')
  // the agent's `lineclear check` runs in the task's folder, in B's environment
  const settings = readSettings('lane')
  if (typeof settings === 'string') throw new Error(settings)
  const onB = { ...process.env, LINECLEAR_MACHINE: 'boxb' }
  expect(await checkTier([], settings, () => {}, onB, wt(t), async () => 0)).toBe(0)
  expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
  const runs = Runs.readRuns(dir, 0)
  expect(runs.map((r) => r.tier)).toContain('merge')
  expect(runs.length).toBeGreaterThan(1)
  expect(runs.every((r) => r.machine === 'boxb')).toBe(true)
  expect(runs.some((r) => r.machine === Runs.machineOf())).toBe(false)
})
