// A server restart ends its RPC agents: each live one starts again from its own session, a cut turn gets one "carry on",
// and a start that keeps failing stops with a card instead of looping.
import { describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'shep-resume-'))
process.env.LINECLEAR_HOME = join(dir, 'home')
mkdirSync(join(dir, 'bin'))
mkdirSync(join(dir, 'wt'))
const told = join(dir, 'told.txt')
const spawned = join(dir, 'spawned.txt')
// a stand-in pi: logs how it was started and what it was told, works a moment on each prompt
writeFileSync(
  join(dir, 'bin', 'pi'),
  `#!/usr/bin/env bun
import { appendFileSync } from 'node:fs'
appendFileSync('${spawned}', process.argv.slice(2).join(' ') + '\\n')
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
let buf = ''
process.stdin.on('data', (d) => {
  buf += d
  for (let i = buf.indexOf('\\n'); i >= 0; i = buf.indexOf('\\n')) {
    const c = JSON.parse(buf.slice(0, i))
    buf = buf.slice(i + 1)
    if (c.type === 'get_state') send({ id: c.id, type: 'response', command: 'get_state', success: true, data: {} })
    if (c.type === 'prompt') {
      appendFileSync('${told}', c.message + '\\n')
      send({ id: c.id, type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } })
      send({ type: 'agent_start' })
      setTimeout(() => send({ type: 'agent_settled' }), 100)
    }
  }
})
`,
)
chmodSync(join(dir, 'bin', 'pi'), 0o755)
process.env.PATH = `${join(dir, 'bin')}:${process.env.PATH}`

const { Agents } = await import('../server/live/agents.ts')
const { Resumes } = await import('../server/live/agent-resume.ts')

const until = async (ok: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; !ok(); await Bun.sleep(20)) if (Date.now() > end) throw new Error('timed out')
}
const lines = (file: string) => (Bun.file(file).size ? Bun.file(file).text().then((t) => t.split('\n').filter(Boolean)) : Promise.resolve([]))
const spec = (key: string) => ({ key, name: `shep-${key.split('/')[0].toLowerCase()}`, kind: 'pi' as const, cwd: join(dir, 'wt'), workspace: key, model: 'default', rpc: true })

describe('agents resume after a restart', () => {
  test('5 live agents start again within 10 s with their session; only a cut turn is told to carry on', async () => {
    const keys = Array.from({ length: 5 }, (_, i) => `R-${i}/Agent`)
    const before = new Agents()
    for (const k of keys) await before.ensure({ ...spec(k), first: 'Do the task.' })
    await until(() => keys.every((k) => before.status(k) === 'idle'))
    const sessions = Object.fromEntries(keys.map((k) => [k, before.record(k)?.sessionId]))
    before.stop()
    for (const k of keys) await before.finish(k)
    writeFileSync(spawned, '')
    writeFileSync(told, '')

    // the new server: its records are read from disk; one agent was mid-turn when the old server ended
    const after = new Agents()
    after.records[keys[0]].working = true
    const begun = Date.now()
    const resumes = new Resumes({
      resumable: (k) => !after.rpcs.has(k),
      wasWorking: (k) => after.wasWorking(k),
      start: (k) => after.relaunch(k, false, () => after.ensure(spec(k))),
      carryOn: (k) => after.send(k, 'Carry on.'),
      gaveUp: () => undefined,
    })
    await resumes.all(keys)
    expect(Date.now() - begun).toBeLessThan(10_000)
    const starts = await lines(spawned)
    expect(starts).toHaveLength(5)
    for (const k of keys) expect(starts.some((s) => s.includes(`--session-id ${sessions[k]}`))).toBe(true)
    await until(() => Bun.file(told).size > 0)
    await Bun.sleep(300)
    expect(await lines(told)).toEqual(['Carry on.'])
    after.stop()
  })

  test('3 failed starts in an hour stop with a card, and it is not tried again', async () => {
    const asked: string[] = []
    let tries = 0
    const resumes = new Resumes(
      {
        resumable: () => true,
        wasWorking: () => false,
        start: async () => {
          tries++
          throw new Error('no pi')
        },
        carryOn: async () => undefined,
        gaveUp: (k) => asked.push(k),
      },
      { gaps: [0, 0, 0], window: 3_600_000 },
    )
    await resumes.all(['X-1/Agent'])
    expect(tries).toBe(3)
    expect(asked).toEqual(['X-1/Agent'])
    await resumes.all(['X-1/Agent'])
    expect(tries).toBe(3)
    // the hour passed: it may try again
    expect(resumes.stopped('X-1/Agent', Date.now() + 3_600_001)).toBe(false)
  })
})
