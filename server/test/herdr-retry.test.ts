// A herdr call whose socket closes before the reply is asked once more. A second close fails plainly.
import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'shep-retry-'))
process.env.LINECLEAR_HOME = dir
const path = join(dir, 'herdr.sock')
process.env.HERDR_SOCKET_PATH = path
const { rpc } = await import('../server/live/herdr.ts')

let drops = 0
let calls = 0
const herdr = createServer((c) => {
  c.on('error', () => undefined)
  c.on('data', (d) => {
    calls++
    if (drops > 0) {
      drops--
      c.destroy()
      return
    }
    c.write(`${JSON.stringify({ id: JSON.parse(String(d).trim()).id, result: 'ok' })}\n`)
  })
})
await new Promise<void>((r) => herdr.listen(path, r))
afterAll(() => herdr.close())

test('one close is retried', async () => {
  drops = 1
  calls = 0
  expect(await rpc('x')).toBe('ok')
  expect(calls).toBe(2)
})

test('a second close fails', async () => {
  drops = 2
  calls = 0
  await expect(rpc('x')).rejects.toThrow('herdr closed the connection')
  expect(calls).toBe(2)
})
