// The loop stays free (L307): a request path or a change handler of a busy board runs no synchronous spawn and
// reads no file over 100 KB on the loop, since either holds every other request, herdr calls included.
import { afterAll, expect, mock, test } from 'bun:test'
import * as realFs from 'node:fs'

const BIG = 100 * 1024
const hits: string[] = []
const copy = { ...realFs }
const read = (...a: Parameters<typeof realFs.readFileSync>) => {
  const [file] = a
  const size = typeof file === 'string' ? (copy.statSync(file, { throwIfNoEntry: false })?.size ?? 0) : 0
  if (size > BIG) hits.push(`read of ${file} (${size} bytes)`)
  return copy.readFileSync(...a)
}
mock.module('node:fs', () => ({ ...copy, readFileSync: read, default: { ...copy, readFileSync: read } }))
const spawnSync = Bun.spawnSync
Bun.spawnSync = ((...a: Parameters<typeof spawnSync>) => {
  hits.push(`spawn of ${JSON.stringify(Array.isArray(a[0]) ? a[0] : (a[0] as { cmd: string[] }).cmd).slice(0, 80)}`)
  return spawnSync(...a)
}) as typeof Bun.spawnSync

const { startBoard } = await import('./loop-board.ts')
const board = await startBoard()
afterAll(() => {
  Bun.spawnSync = spawnSync
  board.stop()
})

test('requests and changes on a board of 400 tasks run nothing synchronous that is slow', async () => {
  hits.length = 0
  const stop = board.churn()
  const paths = ['/api/snapshot', '/api/waiting', '/api/chat?key=B-1/Agent', '/api/health']
  for (let i = 0; i < 5; i++) {
    await Promise.all(paths.map((p) => fetch(`${board.base}${p}`).then((r) => r.arrayBuffer())))
    board.src.emit('chat', 'B-1/Agent')
    await Bun.sleep(250)
  }
  stop()
  expect([...new Set(hits)]).toEqual([])
})

test('the check sees a spawn and a big read on the loop', () => {
  hits.length = 0
  Bun.spawnSync(['true'])
  const big = `${process.env.TMPDIR ?? '/tmp'}/loop-hot-big-${process.pid}`
  realFs.writeFileSync(big, 'x'.repeat(BIG + 1))
  realFs.readFileSync(big)
  realFs.rmSync(big)
  expect(hits).toHaveLength(2)
  hits.length = 0
})
