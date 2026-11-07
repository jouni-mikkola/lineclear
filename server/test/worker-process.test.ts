import { describe, expect, test } from 'bun:test'
import { running } from '../server/live/worker-process.ts'

describe('worker-process', () => {
  test('a process is adopted only with the token it was started with', async () => {
    const child = Bun.spawn(['sleep', '30'], { env: { ...process.env, LINECLEAR_TOKEN: 'right' } })
    try {
      expect(running(child.pid, 'wrong')).toBeUndefined()
      expect(running(child.pid, undefined)).toBeUndefined()
      const w = running(child.pid, 'right')
      expect(w?.pid).toBe(child.pid)
      w?.kill()
      await w?.exited
    } finally {
      child.kill()
    }
  })

  test('a reused pid (a process with no token) is not adopted', () => {
    expect(running(process.pid + 100000, 'right')).toBeUndefined()
    expect(running(1, 'right')).toBeUndefined()
  })
})
