import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkLine,
  inTurn,
  joinLine,
  leaveLine,
  lineOf,
  linesOf,
  lineState,
  machineOf,
  machineOfLine,
  STUCK_MS,
  stuckHeads,
  takeSlots,
} from '../server/live/engine/check-queue.ts'
import { landingLine } from '../server/live/engine/engine.ts'

const queueDir = (env: { LINECLEAR_CONFIG: string }) => join(env.LINECLEAR_CONFIG, 'check-queue', 'a')
/** marks a turn as running its check, as watchProgress does */
const startedAs = (turn: string, cfg: { LINECLEAR_CONFIG: string }) => {
  const path = join(cfg.LINECLEAR_CONFIG, 'check-queue', turn)
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), work: process.pid }))
}
const fresh = () => ({ LINECLEAR_CONFIG: mkdtempSync(join(tmpdir(), 'check-queue-')) })

describe('the check slot', () => {
  test('one full check at a time, first come first served, each told how many are before it', async () => {
    const env = fresh()
    const ran: string[] = []
    const heard: Record<string, number[]> = { a: [], b: [], c: [] }
    const gates: Record<string, () => void> = {}
    const turn = (who: string) =>
      inTurn(
        who,
        'a',
        () =>
          new Promise<void>((done) => {
            ran.push(who)
            gates[who] = done
          }),
        { env, pollMs: 10, waiting: (n) => heard[who]?.push(n) },
      )
    const a = turn('a')
    const b = turn('b')
    const c = turn('c')
    const until = async (f: () => boolean) => {
      while (!f()) await Bun.sleep(10)
    }
    await until(() => ran.length === 1)
    expect(ran).toEqual(['a'])
    expect(checkLine('a', env).map((t) => t.who)).toEqual(['a', 'b', 'c'])
    gates.a?.()
    await a
    await until(() => ran.length === 2)
    expect(ran).toEqual(['a', 'b'])
    gates.b?.()
    await b
    await until(() => ran.length === 3)
    gates.c?.()
    await c
    expect(ran).toEqual(['a', 'b', 'c'])
    expect(heard).toEqual({ a: [0], b: [1, 0], c: [2, 1, 0] })
    expect(checkLine('a', env)).toEqual([])
  })

  test('a turn ends however its check ends', async () => {
    const env = fresh()
    await expect(
      inTurn(
        'x',
        'a',
        async () => {
          throw new Error('broke')
        },
        { env },
      ),
    ).rejects.toThrow('broke')
    expect(checkLine('a', env)).toEqual([])
  })

  test('the turn of a process that is gone leaves the line, so a killed check never holds it', async () => {
    const env = fresh()
    // a process that has ended: its pid is free
    const gone = Bun.spawnSync(['true']).pid
    mkdirSync(queueDir(env), { recursive: true })
    writeFileSync(join(queueDir(env), '000000000000001-x.json'), JSON.stringify({ pid: gone, who: 'killed', since: 1 }))
    const mine = joinLine('mine', 'a', env)
    expect(checkLine('a', env).map((t) => t.who)).toEqual(['mine'])
    leaveLine(mine, env)
    expect(await inTurn('next', 'a', async () => 'ran', { env })).toBe('ran')
  })

  test('a merge turn goes before task-side checks that came earlier, but not before the running check', () => {
    const cfg = fresh()
    startedAs(joinLine('running', 'a', cfg, 1), cfg)
    joinLine('task', 'a', cfg, 2)
    joinLine('merge', 'a', cfg, 3, true)
    expect(checkLine('a', cfg).map((t) => t.who)).toEqual(['running', 'merge', 'task'])
  })

  test('a turn whose task is gone leaves at once and does not run', async () => {
    const cfg = fresh()
    const held = joinLine('holder', 'a', cfg, 1)
    startedAs(held, cfg)
    let gone = false
    setTimeout(() => (gone = true), 50)
    const r = await inTurn('LINE-30', 'a', async () => 'ran', { env: cfg, pollMs: 10, dropped: () => (gone ? 'left' : undefined) })
    expect(r).toBe('left')
    expect(checkLine('a', cfg).map((t) => t.who)).toEqual(['holder'])
    leaveLine(held, cfg)
  })

  test("a merge's line while it waits and while its check runs", () => {
    expect(landingLine({ step: 'queue', at: 0, ahead: 2 })).toBe('Waits for the check slot · 2 ahead')
    expect(landingLine({ step: 'queue', at: 0 })).toBe('Waits for the check slot')
    expect(landingLine({ step: 'check', at: 0 })).toBe('Check running')
  })
})

describe('one line per repo', () => {
  test('a check waits for a free machine slot and hears it', async () => {
    const env = fresh()
    const slots = join(env.LINECLEAR_CONFIG, 'check-slots', machineOf())
    mkdirSync(slots, { recursive: true })
    writeFileSync(join(env.LINECLEAR_CONFIG, 'machine.json'), JSON.stringify({ checkSlots: 1, loadPerCore: 1e6 }))
    // a held slot (this process is alive) and a stale one (its process is gone)
    writeFileSync(join(slots, 'slot-0'), String(process.pid))
    const heard: [number, number][] = []
    let ran = false
    const turn = inTurn(
      'c',
      'a',
      async () => {
        ran = true
      },
      { env, pollMs: 10, waiting: (n, h) => heard.push([n, h]) },
    )
    while (heard.length === 0) await Bun.sleep(10)
    expect(ran).toBe(false)
    rmSync(join(slots, 'slot-0'))
    await turn
    expect(ran).toBe(true)
    expect(heard).toEqual([
      [0, 1],
      [0, 0],
    ])
    expect(takeSlots(1, env)).toBeDefined()
  })

  test('a stuck head in one repo does not delay a check in another', async () => {
    const env = fresh()
    writeFileSync(join(env.LINECLEAR_CONFIG, 'machine.json'), JSON.stringify({ checkSlots: 2, loadPerCore: 1e6 }))
    const stuck = joinLine('stuck', 'repo-a', env)
    startedAs(stuck, env)
    expect(stuck).toContain('repo-a/')
    const t0 = Date.now()
    expect(await inTurn('other', 'repo-b', async () => 'ran', { env, pollMs: 10 })).toBe('ran')
    expect(Date.now() - t0).toBeLessThan(2000)
    // repo B's check landed and left; repo A's head still holds its own line
    expect(checkLine('repo-b', env)).toEqual([])
    expect(checkLine('repo-a', env).map((t) => t.who)).toEqual(['stuck'])
    // a second check of repo A waits behind the stuck head
    const behind: number[] = []
    const waiting = inTurn('next', 'repo-a', async () => 'ran', { env, pollMs: 10, waiting: (n) => behind.push(n) })
    while (behind.length === 0) await Bun.sleep(10)
    expect(behind).toEqual([1])
    leaveLine(stuck, env)
    expect(await waiting).toBe('ran')
  })

  test('the machine slots stay one limit for every line', async () => {
    const env = fresh()
    writeFileSync(join(env.LINECLEAR_CONFIG, 'machine.json'), JSON.stringify({ checkSlots: 1, loadPerCore: 1e6 }))
    const held = takeSlots(1, env) ?? []
    const heard: [number, number][] = []
    const other = inTurn('other', 'repo-b', async () => 'ran', { env, pollMs: 10, waiting: (n, h) => heard.push([n, h]) })
    while (heard.length === 0) await Bun.sleep(10)
    // first in its own line, yet it waits: no slot is free
    expect(heard[0]).toEqual([0, 1])
    for (const f of held) rmSync(f)
    expect(await other).toBe('ran')
  })

  test('a head with no progress for 10 minutes shows as stuck, once a lane turn waits, with what it waits for', async () => {
    const env = fresh()
    const child = Bun.spawn(['sleep', '60'])
    try {
      const turn = joinLine('LIN-1', 'a', env, 0)
      const file = join(env.LINECLEAR_CONFIG, 'check-queue', turn)
      const t = JSON.parse(readFileSync(file, 'utf8'))
      writeFileSync(file, JSON.stringify({ ...t, work: child.pid, cpu: 1, moved: 1000 }))
      expect(stuckHeads('a', env, 1000 + STUCK_MS - 1)).toEqual([])
      // nobody waits behind it: a slow check holds nothing back
      expect(stuckHeads('a', env, 1000 + STUCK_MS)).toEqual([])
      joinLine('lane', 'a', env, 5, true)
      const [s] = stuckHeads('a', env, 1000 + STUCK_MS)
      expect(s?.who).toBe('LIN-1')
      expect(s?.reason).toContain('sleep')
    } finally {
      child.kill()
    }
  })
})

describe('a line per machine', () => {
  test('two long checks of another machine in line do not hold a merge on this one', async () => {
    const cfg = fresh().LINECLEAR_CONFIG
    writeFileSync(join(cfg, 'machine.json'), JSON.stringify({ checkSlots: 1, loadPerCore: 1e6 }))
    const here = { LINECLEAR_CONFIG: cfg, LINECLEAR_MACHINE: 'here' }
    const there = { LINECLEAR_CONFIG: cfg, LINECLEAR_MACHINE: 'there' }
    expect(lineOf('/repo', here)).not.toBe(lineOf('/repo', there))
    expect(machineOfLine(lineOf('/repo', there))).toBe('there')
    const gates: (() => void)[] = []
    const long = () => inTurn('far', lineOf('/repo', there), () => new Promise<void>((done) => gates.push(done)), { env: there, pollMs: 10 })
    const far = [long(), long()]
    while (gates.length < 1) await Bun.sleep(10)
    // one runs holding the only slot of "there", the other waits behind it
    expect(checkLine(lineOf('/repo', there), there)).toHaveLength(2)
    const heard: number[] = []
    const merged = await inTurn('LIN-1', lineOf('/repo', here), async () => 'landed', { env: here, pollMs: 10, waiting: (n) => heard.push(n) })
    expect(merged).toBe('landed')
    expect(heard).toEqual([0])
    expect(checkLine(lineOf('/repo', there), there)).toHaveLength(2)
    expect(linesOf('/repo', here).map(machineOfLine)).toEqual(['here', 'there'])
    expect(lineState(lineOf('/repo', there), there)).toBe('the check line of there: far runs, 1 wait')
    expect(lineState(lineOf('/repo', here), here)).toBe('')
    gates[0]?.()
    while (gates.length < 2) await Bun.sleep(10)
    gates[1]?.()
    await Promise.all(far)
  })
})
