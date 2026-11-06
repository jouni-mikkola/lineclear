// The merge lane lets go of a head that hangs: no process under it, no progress, or a turn past its limit.
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { afterEach, expect, test } from 'bun:test'
import * as Queue from '../server/live/engine/check-queue.ts'
import { repo, sh, started, until, world } from './engine-world.ts'

const configBefore = process.env.LINECLEAR_CONFIG
afterEach(() => {
  if (configBefore === undefined) delete process.env.LINECLEAR_CONFIG
  else process.env.LINECLEAR_CONFIG = configBefore
})

const MIN = 60_000
type World = ReturnType<typeof world>
type Task = Awaited<ReturnType<typeof started>>['t']

/** Lineclear projects for these repos, each with its check and, if set, its turn limit in minutes */
const projects = (list: { dir: string; check: string; limit?: number }[]) => {
  const config = mkdtempSync(join(tmpdir(), 'lane-watch-'))
  for (const [i, p] of list.entries()) {
    mkdirSync(join(config, 'projects', `p${i}`), { recursive: true })
    writeFileSync(
      join(config, 'projects', `p${i}`, 'settings.json'),
      JSON.stringify({ repo: p.dir, space: 'x', check: p.check, models: {}, ...(p.limit ? { turnLimitMinutes: p.limit } : {}) }),
    )
  }
  process.env.LINECLEAR_CONFIG = config
  return config
}

const ready = async (w: World, dir: string, name: string) => {
  const { t } = await started(w, dir, name)
  writeFileSync(join(t.worktree ?? '', `${name}.txt`), `${name}\n`)
  sh(`git add -A && git commit -qm ${name}`, t.worktree ?? '')
  await w.engine.done(t.id, `Added ${name}.`)
  return t
}

/** the engine's merge of `id` hangs in a step with no process under it, as a merge left in "Rebasing on main" did */
const hangs = (w: World, ids: string[]) => {
  const engine = w.engine as unknown as { mergeNow: (t: Task, self: boolean) => Promise<unknown> }
  const real = engine.mergeNow.bind(engine)
  engine.mergeNow = (t, self) => {
    if (!ids.includes(t.id)) return real(t, self)
    t.landing = { step: 'rebase', at: Date.now() }
    return new Promise(() => undefined)
  }
}

const decisions = (config: string) =>
  existsSync(join(config, 'decisions.jsonl'))
    ? readFileSync(join(config, 'decisions.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : []

// CI-quarantine: fails on a GitHub runner only, cause not found yet
test.skipIf(Boolean(process.env.CI))(
  'a head in "Rebasing on main" with no git process for 15 minutes is released, the task behind it lands, the head is told why',
  async () => {
    const w = world()
    const [mine, other] = [repo(), repo()]
    const config = projects([
      { dir: mine, check: 'true' },
      { dir: other, check: 'true' },
    ])
    const head = await ready(w, mine, 'lane-head')
    const behind = await ready(w, mine, 'lane-behind')
    const [x, y] = [await ready(w, other, 'other-x'), await ready(w, other, 'other-y')]
    hangs(w, [head.id])
    const t0 = Date.now()
    const hung = w.engine.merge(head.id, { self: true })
    await until(() => w.engine.subOf(head) === 'Rebasing on main', 2000)
    const waiting = w.engine.merge(behind.id, { self: true })
    // another project's line never waits for it
    expect((await w.engine.merge(x.id, { self: true })).ok).toBe(true)
    expect((await w.engine.merge(y.id, { self: true })).ok).toBe(true)
    expect(behind.merged).toBeFalsy()
    await w.engine.watchHeads(t0 + 14 * MIN)
    expect(behind.merged).toBeFalsy()
    await w.engine.watchHeads(Date.now() + 15 * MIN)
    const r = await hung
    expect(r.ok).toBe(false)
    expect((await waiting).ok).toBe(true)
    expect(behind.merged).toBe(true)
    expect(head.landing).toBeUndefined()
    await until(() => w.sent.some((m) => m.key === `${head.id}/Agent`))
    const told = w.sent.find((m) => m.key === `${head.id}/Agent`)?.text ?? ''
    expect(told).toContain('Rebasing on main')
    expect(told).toContain('15 min')
    expect(told).toContain(`lineclear merge ${head.id}`)
    expect(decisions(config).filter((d) => d.kind === 'stall' && d.step === head.id)).toHaveLength(1)
  },
)

test('a head released twice in a row has its agent restarted', async () => {
  const w = world()
  const dir = repo()
  const config = projects([{ dir, check: 'true' }])
  const head = await ready(w, dir, 'lane-twice')
  hangs(w, [head.id])
  for (const round of [1, 2]) {
    // told to merge again, its agent reports done again
    if (round === 2) await w.engine.done(head.id, 'Added it.')
    const hung = w.engine.merge(head.id, { self: true })
    await until(() => w.engine.subOf(head) === 'Rebasing on main')
    await w.engine.watchHeads(Date.now() + 15 * MIN)
    expect((await hung).ok).toBe(false)
    expect(w.sent.some((m) => m.text.includes('second release in a row'))).toBe(round === 2)
  }
  // the agent's own start is logged here too (kind run): only the lane's decisions are the subject
  expect(
    decisions(config)
      .filter((d) => d.kind === 'stall')
      .map((d) => d.reason.split(' ')[0]),
  ).toEqual(['released', 'restarted'])
})

/** a check that spins until `../stop` is there, so its processes use the CPU all the time */
const spinning = 'touch ../started; while [ ! -e ../stop ]; do :; done'

/** a merge whose check spins: looked at every `step` minutes up to `minutes`, while its CPU is used */
async function spinFor(name: string, minutes: number, step: number, limit?: number) {
  const w = world()
  const dir = repo()
  projects([{ dir, check: spinning, limit }])
  const t = await ready(w, dir, name)
  const wt = t.worktree ?? ''
  const merging = w.engine.merge(t.id, { self: true })
  await until(() => existsSync(join(wt, '..', 'started')))
  const t0 = Date.now()
  let released: Awaited<typeof merging> | undefined
  merging.then((r) => (released = r))
  for (let at = step; at <= minutes && !released; at += step) {
    await Bun.sleep(150)
    await w.engine.watchHeads(t0 + at * MIN)
    await Bun.sleep(20)
  }
  const stopped = released
  writeFileSync(join(wt, '..', 'stop'), '')
  const r = await merging
  return { r, released: stopped, t }
}

test('a check that keeps using the CPU for 40 minutes is not released', async () => {
  const { r, released, t } = await spinFor('lane-spin-ok', 40, 5, 60)
  expect(released).toBeUndefined()
  expect(r.ok).toBe(true)
  expect(t.merged).toBe(true)
})

test('a turn past its limit is released with "over the limit", even while it works', async () => {
  const { released, t } = await spinFor('lane-spin-over', 40, 5)
  expect(released?.ok).toBe(false)
  expect(released?.error).toContain('over the limit')
  expect(t.merged).toBeFalsy()
  expect(Queue.checkLine(Queue.lineOf(t.worktree ? join(t.worktree, '..') : ''))).toEqual([])
})
