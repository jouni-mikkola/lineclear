// A git step that never ends is aborted at its own timeout, or when its merge is released, with its process group dead.
import { expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import * as G from '../server/live/engine/git.ts'

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// a shell that starts a grandchild and waits for it; says the grandchild's pid first
const hang = ['sh', '-c', 'sleep 60 & echo $!; wait']

test('a step that never ends is killed at its timeout with whatever it started', async () => {
  const t0 = Date.now()
  const r = await G.sh(hang, tmpdir(), { timeoutMs: 300 })
  expect(Date.now() - t0).toBeLessThan(5000)
  expect(r.ok).toBe(false)
  expect(r.err).toContain('timed out')
  const child = Number(r.out.split('\n')[0])
  expect(child).toBeGreaterThan(0)
  await Bun.sleep(100)
  expect(alive(child)).toBe(false)
})

test('a released merge ends its running step with whatever it started', async () => {
  const ctl = new AbortController()
  const run = G.stepSignal.run(ctl.signal, () => G.sh(hang, tmpdir()))
  setTimeout(() => ctl.abort(), 300)
  const r = await run
  expect(r.ok).toBe(false)
  const child = Number(r.out.split('\n')[0])
  await Bun.sleep(100)
  expect(alive(child)).toBe(false)
})
