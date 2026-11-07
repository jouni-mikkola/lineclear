import { expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const box = { label: 'b', target: 'b', session: 's', herdr: 'herdr', home: '/h', path: '/bin', os: 'Linux' }

test('45 reads of a file on a box leave the event loop free', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lc-box-reads-'))
  mkdirSync(join(dir, 'bin'))
  // a box that takes 50 ms to answer each call: waiting for 45 of them in turn would stall the loop for over 2 s
  writeFileSync(join(dir, 'bin', 'ssh'), '#!/bin/sh\nsleep 0.05\necho hello\n')
  chmodSync(join(dir, 'bin', 'ssh'), 0o755)
  const script = `
    import { readFile } from ${JSON.stringify(join(import.meta.dir, '../server/live/mfs.ts'))}
    await readFile('/elsewhere/file', 'utf8') // the first call loads ssh and the pipes
    // the CPU time the loop spends starting the 45 calls, the least of eight rounds (the wall clock of a busy machine
    // delays any one of them). Waiting for the answers holds nothing, since the calls are async.
    const rounds: number[] = []
    let ticks = 0
    const timer = setInterval(() => ticks++, 5)
    const started = performance.now()
    let same = true
    for (let round = 0; round < 8; round++) {
      const began = process.cpuUsage()
      const reads = Array.from({ length: 45 }, () => readFile('/elsewhere/file', 'utf8'))
      const used = process.cpuUsage(began)
      rounds.push((used.user + used.system) / 1000)
      same &&= (await Promise.all(reads)).every((t) => t === 'hello\\n')
    }
    clearInterval(timer)
    console.log(JSON.stringify({ stalled: Math.min(...rounds), same, ticks, beats: (performance.now() - started) / 5 }))
  `
  const r = Bun.spawnSync(['bun', '-e', script], {
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, LINECLEAR_BOX: JSON.stringify(box), LINECLEAR_MAIN_HOME: dir },
    stderr: 'pipe',
  })
  expect(r.stderr.toString()).toBe('')
  const got = JSON.parse(r.stdout.toString()) as { stalled: number; same: boolean; ticks: number; beats: number }
  expect(got.same).toBe(true)
  // the loop kept beating while the box answered: a call that waits for its child would stop it for the whole wait.
  // The bars are low since a busy runner starves the timer; blocked calls would stall the loop over 2 s a round.
  expect(got.ticks).toBeGreaterThan(got.beats / 25)
  expect(got.stalled).toBeLessThan(500)
})
