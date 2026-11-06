// A machine's tasks live in its own store; the board reads them over the link and keeps no copy.
import { expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const task = (status: string) => ({ id: 'FAR-1', name: 'x', status, place: 'p:far:web', machine: 'far', age: '1m' })
const snapOf = (status: string) => ({
  name: 'S',
  host: 'far',
  machines: [{ machine: 'far', status: 'idle' }],
  places: [{ id: 'p:far:web', kind: 'project', level: 2, name: 'web', machine: 'far', status: 'idle', mode: 'regular', chat: 'p:far:web' }],
  tasks: [task(status)],
})

/** a remote machine's worker: serves the snapshot it has now, and keeps the actions sent to it */
function farWorker() {
  const w = { status: 'work', actions: [] as { text: string }[], down: false, server: null as unknown as ReturnType<typeof Bun.serve> }
  w.server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      if (w.down) return new Response('down', { status: 503 })
      if (new URL(req.url).pathname === '/api/action') {
        w.actions.push((await req.json()) as { text: string })
        return Response.json({ ok: true })
      }
      return Response.json(snapOf(w.status))
    },
  })
  return w
}

async function linked() {
  const { Machines } = await import('../server/live/machines.ts')
  const far = farWorker()
  const m = new Machines(null)
  const l = m.adopt('far', `http://127.0.0.1:${far.server.port}`)
  for (let i = 0; i < 100 && !l.reachable; i++) await Bun.sleep(20)
  const poll = () => (m as unknown as { poll(l: unknown): Promise<void> }).poll(l)
  return { m, l, far, poll, end: () => (m.stop(), far.server.stop(true)) }
}

test('no copy of another machine is written: an update removes the old mirrors', async () => {
  const { HOME, writeJson } = await import('../server/store.ts')
  const { Machines } = await import('../server/live/machines.ts')
  const saved = { id: 'old', label: 'old', target: 'old.invalid', session: 'default', enabled: false }
  writeJson('machines/old/last.json', { saved, snap: snapOf('work'), chats: [] })
  writeJson('machines/old/tasks.json', { tasks: [task('work')] })
  const m = new Machines(
    async () => [saved],
    async () => ({}),
  )
  m.stop()
  expect(existsSync(join(HOME, 'machines', 'old', 'tasks.json'))).toBe(false)
  expect(JSON.parse(readFileSync(join(HOME, 'machines', 'old', 'last.json'), 'utf8')).snap).toBeUndefined()
})

test('a change on the remote machine shows in the next read, and nothing of it is written here', async () => {
  const { HOME } = await import('../server/store.ts')
  const { m, l, far, poll, end } = await linked()
  try {
    expect(m.tasksOf(l).map((t) => t.status)).toEqual(['work'])
    far.status = 'need'
    await poll()
    expect(m.tasksOf(l).map((t) => t.status)).toEqual(['need'])
    m.stop()
    const dir = join(HOME, 'machines')
    const files = existsSync(dir) ? readdirSync(dir).flatMap((d) => readdirSync(join(dir, d)).map((f) => join(dir, d, f))) : []
    expect(files.filter((f) => readFileSync(f, 'utf8').includes('FAR-1'))).toEqual([])
  } finally {
    end()
  }
})

test('with the link down the remote tasks stay as last shown, marked unreachable', async () => {
  const { m, l, far, poll, end } = await linked()
  try {
    expect(m.tasksOf(l)[0].unreachableSince).toBeUndefined()
    far.down = true
    await poll()
    expect(l.reachable).toBe(false)
    const [t] = m.tasksOf(l)
    expect(t.status).toBe('work')
    expect(t.unreachableSince).toBeTruthy()
  } finally {
    end()
  }
})

test('100 status changes go once each to the machine that owns the task and never back', async () => {
  const { m, l, far, end } = await linked()
  try {
    for (let i = 0; i < 100; i++) await m.act(l, { type: 'send', chat: 'FAR-1/Agent', text: `n${i}` })
    await Bun.sleep(100)
    expect(far.actions.map((a) => a.text)).toEqual(Array.from({ length: 100 }, (_, i) => `n${i}`))
  } finally {
    end()
  }
})
