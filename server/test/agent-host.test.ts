import { expect, test } from 'bun:test'

const COUNT = 12
// A stand-in pi: answers every line it gets with an event line, ends on "quit"
const STAND_IN = `
require('node:readline').createInterface({ input: process.stdin }).on('line', (l) => {
  console.log(JSON.stringify({ type: 'echo', got: l }))
  if (l === 'quit') process.exit(0)
})`

test('one host carries 12 stand-in pi children: events under their keys, 12 exits, a room frame', async () => {
  const host = Bun.spawn(['bun', `${import.meta.dir}/../helper/agent-host.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' })
  const frames: Record<string, unknown>[] = []
  const reader = (async () => {
    let rest = ''
    for await (const chunk of host.stdout) {
      rest += new TextDecoder().decode(chunk)
      const lines = rest.split('\n')
      rest = lines.pop() ?? ''
      for (const l of lines) frames.push(JSON.parse(l))
    }
  })()
  const write = (f: object) => host.stdin.write(`${JSON.stringify(f)}\n`)
  const keys = Array.from({ length: COUNT }, (_, i) => `task-${i}`)
  for (const key of keys) write({ type: 'spawn', key, cmd: process.execPath, args: ['-e', STAND_IN] })
  for (const key of keys) write({ type: 'send', key, line: `hello ${key}` })
  for (const key of keys) write({ type: 'send', key, line: 'quit' })
  await host.stdin.flush()
  const until = Date.now() + 15_000
  while (frames.filter((f) => f.type === 'exit').length < COUNT && Date.now() < until) await Bun.sleep(25)
  host.stdin.end()
  await host.exited
  await reader

  for (const key of keys) {
    const events = frames.filter((f) => f.type === 'event' && f.key === key).map((f) => JSON.parse(String(f.line)).got)
    expect(events).toEqual([`hello ${key}`, 'quit'])
  }
  const exits = frames.filter((f) => f.type === 'exit')
  expect(exits.map((f) => f.key).sort()).toEqual([...keys].sort())
  expect(exits.every((f) => f.code === 0)).toBe(true)
  const roomFrame = frames.find((f) => f.type === 'room')
  expect(roomFrame).toMatchObject({ cores: expect.any(Number), load: expect.any(Number), memAvailable: expect.any(Number), running: expect.any(Number) })
}, 30_000)

test('stop ends a child', async () => {
  const host = Bun.spawn(['bun', `${import.meta.dir}/../helper/agent-host.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' })
  host.stdin.write(`${JSON.stringify({ type: 'spawn', key: 'k', cmd: 'sleep', args: ['60'] })}\n`)
  host.stdin.write(`${JSON.stringify({ type: 'stop', key: 'k' })}\n`)
  await host.stdin.flush()
  let seen = ''
  for await (const chunk of host.stdout) {
    seen += new TextDecoder().decode(chunk)
    if (seen.includes('"type":"exit"')) break
  }
  expect(seen).toContain('"key":"k"')
  host.stdin.end()
  await host.exited
})
