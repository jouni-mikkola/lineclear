import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAddress, running } from '../server/live/worker-process.ts'

describe('worker-process', () => {
  test('a started worker is seen at the address it prints, even split in chunks, and its output is logged', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'wp-')), 'worker.log')
    const parts = ['booting\nlineclear on http://127.0.', '0.1:4321, ready 5 ms after start\n']
    const stdout = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(new TextEncoder().encode(p))
        c.close()
      },
    })
    const ports: number[] = []
    await readAddress(stdout, log, (p) => ports.push(p))
    expect(ports).toEqual([4321])
    expect(readFileSync(log, 'utf8')).toBe(parts.join(''))
  })

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
