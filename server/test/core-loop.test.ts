// The core loop end to end on a scratch repo (no remote, no workflow) with a fake pi agent: two steps are added, built,
// reviewed and merged, the second queued after the first. The server is killed once at each point of the loop and
// comes back on the same store: 2 steps merged, 2 tasks made, no agent started twice.
// A case that fails today is marked with the step that fixes it (KNOWN) and runs as todo until then.
import { describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakePi } from './fake-pi.ts'
import { until } from './until.ts'

process.env.LINECLEAR_HOME = mkdtempSync(join(tmpdir(), 'shep-loop-'))
process.env.LINECLEAR_WORKTREES = join(process.env.LINECLEAR_HOME, 'worktrees')
const { Engine } = await import('../server/live/engine/engine.ts')
const { Places } = await import('../server/live/places.ts')
const { Settings } = await import('../server/live/settings.ts')

const POINTS = ['add', 'start', 'ready', 'review', 'queue', 'merge'] as const
type Point = (typeof POINTS)[number]

/** the points where the loop is lost today, and the step that fixes each */
// (a start the old server was in the middle of is never made again: no phase resumes it)
const KNOWN: Partial<Record<Point, string>> = { add: 'L710', queue: 'L710' }

const sh = (cmd: string, cwd: string) => execSync(cmd, { cwd, shell: '/bin/sh', encoding: 'utf8' }).trim()

async function loop(killAt?: Point) {
  const dir = mkdtempSync(join(tmpdir(), 'shep-loop-repo-'))
  sh('git init -q -b main && git config user.email t@t && git config user.name T && echo hi > README.md && git add -A && git commit -qm init', dir)
  const pi = fakePi()
  const engines: InstanceType<typeof Engine>[] = []
  let places = new Places()
  const boot = () => {
    const settings = new Settings()
    settings.set('machine.maxTasks', '50')
    places = new Places()
    const e = new Engine(pi.forEngine() as never, pi.chats as never, places, settings)
    engines.push(e)
    return e
  }
  let engine = boot()
  const project = (await places.add(dir, `loop-${killAt ?? 'none'}`)).name
  /** the server is killed here: its timers stop, and a new one reads the same store */
  const point = (at: Point) => {
    if (at !== killAt) return
    engine.stop()
    engine = boot()
  }
  const id = (n: string) => engine.tasks.find((t) => t.title.startsWith(n) && t.project.endsWith(project))!.id
  const key = (n: string) => `${id(n)}/Agent`
  try {
    engine.add({ project, title: 'L1 First step', desc: 'Add one.txt.', by: 'test' })
    point('add')
    await until(() => pi.starts.some((s) => s.key === key('L1')), 'step 1 starts', 3000)
    point('start')
    pi.work(key('L1'), 'one.txt')
    await engine.done(id('L1'), 'Added one.txt.')
    pi.idle(key('L1'))
    point('ready')
    pi.review(key('L1'))
    point('review')
    engine.add({ project, title: 'L2 Second step', desc: 'Add two.txt.', by: 'test', after: [id('L1')] })
    point('queue')
    await engine.merge(id('L1'))
    point('merge')
    await until(() => !!engine.task(id('L1'))?.merged, 'step 1 merged')
    await until(() => pi.starts.some((s) => s.key === key('L2')), 'step 2 starts', 3000)
    await until(() => pi.told.some((m) => m.key === key('L2')), 'step 2 told to go', 3000)
    pi.work(key('L2'), 'two.txt')
    await engine.done(id('L2'), 'Added two.txt.')
    pi.idle(key('L2'))
    pi.review(key('L2'))
    await engine.merge(id('L2'))
    await until(() => !!engine.task(id('L2'))?.merged, 'step 2 merged')
    const keys = pi.starts.map((s) => s.key)
    const mine = engine.tasks.filter((t) => t.project.endsWith(project))
    return {
      merged: mine.filter((t) => t.merged).length,
      made: mine.length,
      twice: keys.filter((k, i) => keys.indexOf(k) !== i).length,
      files: [existsSync(join(dir, 'one.txt')), existsSync(join(dir, 'two.txt'))],
    }
  } finally {
    for (const e of engines) e.stop()
  }
}

describe('the core loop', () => {
  test('without a kill: 2 steps merged, 2 tasks made, 0 started twice', async () => {
    expect(await loop()).toEqual({ merged: 2, made: 2, twice: 0, files: [true, true] })
  })

  for (const at of POINTS) {
    const run = KNOWN[at] ? test.todo : test
    run(`killed after ${at}${KNOWN[at] ? ` (fails today, fixed by ${KNOWN[at]})` : ''}`, async () => {
      expect(await loop(at)).toEqual({ merged: 2, made: 2, twice: 0, files: [true, true] })
    })
  }
})
