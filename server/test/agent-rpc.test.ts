// A task agent is a `pi --mode rpc` child: it starts, takes its brief, works and ends with no herdr call for it.
import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'shep-rpc-'))
process.env.LINECLEAR_HOME = join(dir, 'home')
process.env.HERDR_SOCKET_PATH = join(dir, 'herdr.sock')
mkdirSync(join(dir, 'bin'))
mkdirSync(join(dir, 'wt'))
// a stand-in pi: answers get_state and prompt, works for a moment on each prompt, and writes what it was told to a file
writeFileSync(
  join(dir, 'bin', 'pi'),
  `#!/usr/bin/env bun
import { appendFileSync } from 'node:fs'
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
let buf = ''
let busy = false
let timer
process.stdin.on('data', (d) => {
  buf += d
  for (let i = buf.indexOf('\\n'); i >= 0; i = buf.indexOf('\\n')) {
    const c = JSON.parse(buf.slice(0, i))
    buf = buf.slice(i + 1)
    if (c.type === 'get_state') send({ id: c.id, type: 'response', command: 'get_state', success: true, data: { sessionFile: '${join(dir, 'session.jsonl')}' } })
    if (c.type === 'prompt' && busy && !c.streamingBehavior) send({ id: c.id, type: 'response', command: 'prompt', success: false, error: 'streaming' })
    else if (c.type === 'prompt') {
      busy = true
      appendFileSync('${join(dir, 'told.txt')}', c.message + '\\n')
      send({ id: c.id, type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } })
      send({ type: 'agent_start' })
      clearTimeout(timer)
      timer = setTimeout(() => {
        busy = false
        send({ type: 'agent_settled', aborted: c.message.includes('STOP') })
      }, 600)
    }
  }
})
`,
)
chmodSync(join(dir, 'bin', 'pi'), 0o755)
// a stand-in perl that records each run: an RPC start spawns none
writeFileSync(join(dir, 'bin', 'perl'), `#!/bin/sh\necho run >> '${join(dir, 'perl.txt')}'\n`)
chmodSync(join(dir, 'bin', 'perl'), 0o755)
process.env.PATH = `${join(dir, 'bin')}:${process.env.PATH}`

const asked: string[] = []
const herdr = createServer((c) => {
  c.on('data', (d) => {
    asked.push(String(d))
    c.end()
  })
})
await new Promise<void>((r) => herdr.listen(process.env.HERDR_SOCKET_PATH!, r))

const { Agents } = await import('../server/live/agents.ts')
const { rpcCommand, hasSystemd } = await import('../server/live/agent-rpc.ts')

const until = async (ok: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; !ok(); await Bun.sleep(20)) if (Date.now() > end) throw new Error('timed out')
}

describe('a task agent as a pi RPC child', () => {
  test('starts, takes its brief, works and ends with no herdr call for it', async () => {
    const a = new Agents()
    const key = 'RPC-1/Agent'
    try {
      const began = Date.now()
      await a.ensure({ key, name: 'shep-rpc-1', kind: 'pi', cwd: join(dir, 'wt'), workspace: 'rpc-1', model: 'default', rpc: true, first: 'Do the task.' })
      expect(Date.now() - began).toBeLessThan(3000)
      expect(a.info(key)?.agent_session).toMatchObject({ kind: 'path', value: join(dir, 'session.jsonl') })
      await until(() => Bun.file(join(dir, 'told.txt')).size > 0)
      await until(() => a.status(key) === 'working')
      await a.send(key, 'One more thing.')
      await until(() => a.status(key) === 'idle')
      await until(() => a.waiting(key).length === 0)
      expect(a.aborted(key)).toBe(false)
      await a.send(key, 'STOP now.')
      await until(() => a.status(key) === 'working')
      await until(() => a.status(key) === 'idle')
      expect(a.aborted(key)).toBe(true)
      await a.finish(key)
      expect(a.status(key)).toBe('gone')
      expect(asked.filter((s) => s.includes('shep-rpc-1') || s.includes('rpc:'))).toEqual([])
      expect(await Bun.file(join(dir, 'told.txt')).text()).toContain('One more thing.')
    } finally {
      a.stop()
    }
  })

  test('a start of 45 tasks asks herdr nothing and spawns no perl', async () => {
    const a = new Agents()
    const before = asked.length
    try {
      const keys = Array.from({ length: 45 }, (_, i) => `RPC-${i + 10}/Agent`)
      await Promise.all(
        keys.map((key, i) =>
          a.ensure({ key, name: `shep-rpc-${i + 10}`, kind: 'pi', cwd: join(dir, 'wt'), workspace: 'rpc', model: 'default', rpc: true, first: 'Go.' }),
        ),
      )
      expect(keys.every((k) => a.hasRoute(k))).toBe(true)
      expect(asked.length).toBe(before)
      expect(await Bun.file(join(dir, 'perl.txt')).exists()).toBe(false)
      await Promise.all(keys.map((k) => a.finish(k)))
    } finally {
      a.stop()
    }
  })
})

describe('the memory cap of a task agent', () => {
  test('argv is a capped systemd scope when systemd is there', () => {
    const [cmd, argv] = rpcCommand(['--model', 'm'], true)
    expect(cmd).toBe('systemd-run')
    expect(argv).toEqual([
      '--user',
      '--scope',
      '-q',
      '-p',
      'MemoryHigh=450M',
      '-p',
      'MemoryMax=700M',
      '-p',
      'MemorySwapMax=0',
      'pi',
      '--mode',
      'rpc',
      '--model',
      'm',
    ])
  })

  test('argv is plain when systemd is not there', () => {
    expect(rpcCommand(['--model', 'm'], false)).toEqual(['pi', ['--mode', 'rpc', '--model', 'm']])
  })

  test.skipIf(!hasSystemd())('a child that allocates 1 GB is killed while a second agent keeps running', async () => {
    // memory.high is left at max here: it only slows a process, the kill is memory.max
    const cap = { high: '700M', max: '700M' }
    const greedy = "const b = Buffer.alloc(1e9, 1); console.log('survived', b.length)"
    const [cmd, argv] = rpcCommand([], true, cap)
    const scope = argv.slice(0, argv.indexOf('pi'))
    const spawnIt = (code: string) => Bun.spawn([cmd, ...scope, process.execPath, '-e', code], { stdout: 'pipe', stderr: 'ignore' })
    const calm = spawnIt("await Bun.sleep(800); console.log('alive')")
    const big = spawnIt(greedy)
    expect(await big.exited).not.toBe(0)
    expect(await new Response(big.stdout).text()).not.toContain('survived')
    expect(await calm.exited).toBe(0)
    expect(await new Response(calm.stdout).text()).toContain('alive')
  })
})

afterAll(() => void herdr.close())
