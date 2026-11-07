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
    let last = performance.now()
    let stalled = 0
    const timer = setInterval(() => {
      const now = performance.now()
      stalled += Math.max(0, now - last - 5)
      last = now
    }, 5)
    const texts = await Promise.all(Array.from({ length: 45 }, () => readFile('/elsewhere/file', 'utf8')))
    clearInterval(timer)
    console.log(JSON.stringify({ stalled, same: texts.every((t) => t === 'hello\\n') }))
  `
  const r = Bun.spawnSync(['bun', '-e', script], {
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, LINECLEAR_BOX: JSON.stringify(box), LINECLEAR_MAIN_HOME: dir },
    stderr: 'pipe',
  })
  expect(r.stderr.toString()).toBe('')
  const got = JSON.parse(r.stdout.toString()) as { stalled: number; same: boolean }
  expect(got.same).toBe(true)
  expect(got.stalled).toBeLessThan(50)
})
