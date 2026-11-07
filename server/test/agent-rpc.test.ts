// A task agent is a `pi --mode rpc` child: it starts, takes its brief, works and ends with no herdr call for it.
import { describe, expect, test } from 'bun:test'
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
      setTimeout(() => {
        busy = false
        send({ type: 'agent_settled', aborted: false })
      }, 600)
    }
  }
})
`,
)
chmodSync(join(dir, 'bin', 'pi'), 0o755)
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
      await a.finish(key)
      expect(a.status(key)).toBe('gone')
      expect(asked.filter((s) => s.includes('shep-rpc-1') || s.includes('rpc:'))).toEqual([])
      expect(await Bun.file(join(dir, 'told.txt')).text()).toContain('One more thing.')
    } finally {
      a.stop()
      herdr.close()
    }
  })
})
