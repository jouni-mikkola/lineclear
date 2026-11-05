import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LINECLEAR_HOME = mkdtempSync(join(tmpdir(), 'shep-route-'))
process.env.HERDR_SOCKET_PATH = join(process.env.LINECLEAR_HOME, 'no-herdr.sock')
process.env.NODE_ENV = 'test'
const { LiveSource } = await import('../server/live/source.ts')
const { noTasks } = await import('../server/live/box.ts')
const src = new LiveSource()
afterAll(() => src.stop?.())

test("a task another machine's worker runs: task show goes there; an empty list names who runs this machine's tasks", async () => {
  const got: { args: string[] }[] = []
  const far = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const u = new URL(req.url)
      if (u.pathname === '/api/snapshot')
        return Response.json({
          name: 'S',
          host: 'far3',
          places: [{ id: 'p:far3:~', name: 'home', machine: 'far3', home: true, level: 1, status: 'idle', mode: 'regular', chat: 'p:far3:~' }],
          machines: [{ id: 'm:far3', machine: 'far3', name: 'far3', status: 'idle' }],
          tasks: [{ id: 'FAR-27', name: 'Far task', status: 'work' }],
          automations: {},
          asks: {},
          settings: [],
          overrides: {},
          user: 'u',
        })
      if (u.pathname === '/api/cli') {
        got.push((await req.json()) as { args: string[] })
        return Response.json({ out: 'FAR-27 Far task\n', code: 0 })
      }
      return new Response('no', { status: 404 })
    },
  })
  try {
    src.peers?.adopt('far3', `http://127.0.0.1:${far.port}`)
    for (let i = 0; i < 50 && !src.peers?.list().find((l) => l.rec.machine === 'far3')?.reachable; i++) await new Promise((r) => setTimeout(r, 20))
    const shown = await src.cli(['task', 'show', 'FAR-27'], {})
    expect(shown.code).toBe(0)
    expect(shown.out.trim()).toBe('FAR-27 Far task')
    expect(got[0]?.args).toEqual(['task', 'show', 'FAR-27'])
    expect((await src.cli(['task', 'show', 'NOPE-1'], {})).out).toContain('No task NOPE-1')
  } finally {
    far.stop(true)
  }
  writeFileSync(join(process.env.LINECLEAR_HOME as string, 'run-by'), '"laptop"')
  expect(noTasks()).toContain('run by laptop')
})
