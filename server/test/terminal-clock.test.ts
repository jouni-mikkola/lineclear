// herdr sends no event when a pane's output changes: a terminal on screen is read again on a clock, only while one is,
// and only a change goes out.
import { expect, test } from 'bun:test'
import { join } from 'node:path'

process.env.HERDR_SOCKET_PATH = join(process.env.LINECLEAR_HOME ?? '/tmp', 'absent.sock')
const { Agents } = await import('../server/live/agents.ts')

// a busy machine slows the clock, so the test waits for what it expects instead of a fixed time
const until = async (f: () => boolean, ms = 10000) => {
  for (const t0 = Date.now(); !f(); await Bun.sleep(20)) if (Date.now() - t0 > ms) throw new Error('timed out')
}

test('a watched terminal is read on a clock, sent only when it changed, and the clock stops once none is watched', async () => {
  const a = new Agents()
  let text = 'one'
  let reads = 0
  a.screen = async () => {
    reads++
    return { ansi: text, cols: 80, rows: 24 }
  }
  const sent: string[] = []
  a.on('output', (key, s) => sent.push(`${key} ${s.ansi}`))
  a.watchTerminals(['LIN-1/Agent'])
  await until(() => reads >= 3)
  expect(sent).toEqual(['LIN-1/Agent one'])
  text = 'two'
  await until(() => sent.length >= 2)
  expect(sent).toEqual(['LIN-1/Agent one', 'LIN-1/Agent two'])
  a.watchTerminals([])
  const after = reads
  await Bun.sleep(1200)
  expect(reads).toBe(after)
  a.stop()
}, 30000)

test('watching the same terminals again keeps the clock and what they showed; a read that comes back late is dropped', async () => {
  const { TerminalClock } = await import('../server/live/terminal-clock.ts')
  const pending: ((s: { ansi: string; cols: number; rows: number }) => void)[] = []
  const sent: string[] = []
  const clock = new TerminalClock(
    () => new Promise((done) => pending.push(done)),
    (key, s) => sent.push(`${key} ${s.ansi}`),
    20,
  )
  clock.watch(['a'])
  await until(() => pending.length === 1)
  clock.watch(['a'])
  await Bun.sleep(100)
  expect(pending.length).toBe(1)
  pending[0]?.({ ansi: 'one', cols: 80, rows: 24 })
  await until(() => pending.length === 2)
  pending[1]?.({ ansi: 'one', cols: 80, rows: 24 })
  await until(() => pending.length === 3)
  expect(sent).toEqual(['a one'])
  clock.watch(['b'])
  pending[2]?.({ ansi: 'two', cols: 80, rows: 24 })
  await until(() => sent.some((x) => x.startsWith('b')) || pending.length >= 4)
  expect(sent).toEqual(['a one'])
  clock.stop()
}, 30000)
