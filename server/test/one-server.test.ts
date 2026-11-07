import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dir, '..', 'server', 'main.ts')
const start = (home: string) =>
  Bun.spawn([process.execPath, main], {
    env: { ...process.env, LINECLEAR_HOME: home, LINECLEAR_PORT: '0', LINECLEAR_SOURCE: 'live' },
    stdout: 'pipe',
    stderr: 'pipe',
  })

/** waits until the server has said which port it listens on */
async function ready(home: string) {
  for (let i = 0; i < 200; i++) {
    try {
      return JSON.parse(readFileSync(join(home, 'server.json'), 'utf8')) as { port: number; pid: number }
    } catch {
      await Bun.sleep(50)
    }
  }
  throw new Error('server did not start')
}

test('L157: a second server on the same folder exits at once and names the port and process that hold it (LIN-231)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'one-server-'))
  const first = start(home)
  try {
    const { port, pid } = await ready(home)
    expect(pid).toBe(first.pid)
    // any other port: the lock is on the folder
    const second = start(home)
    expect(await second.exited).toBe(1)
    const said = await new Response(second.stderr).text()
    expect(said).toContain(`process ${first.pid}, port ${port}`)
    // the first still runs and is the only one that answers on this folder
    expect(JSON.parse(readFileSync(join(home, 'server.json'), 'utf8')).pid).toBe(first.pid)
  } finally {
    first.kill()
    await first.exited
  }
})

test('L157: a server whose lock holder died starts as usual', async () => {
  const home = mkdtempSync(join(tmpdir(), 'one-server-'))
  writeFileSync(join(home, 'server.lock'), '999999999')
  const server = start(home)
  try {
    const { pid } = await ready(home)
    expect(pid).toBe(server.pid)
    expect(readFileSync(join(home, 'server.lock'), 'utf8')).toBe(String(server.pid))
  } finally {
    server.kill()
    await server.exited
  }
})
