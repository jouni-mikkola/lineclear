// Nothing routes to a done task: a tell, a restart or a send for a merged or closed one is refused with its state
// before any herdr call, and what waited for it is dropped.
import { expect, setDefaultTimeout, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fakeHerdr, repo, sh, started, world } from './engine-world.ts'

setDefaultTimeout(60_000)

/** a fake herdr that counts every call made on it */
function counted() {
  const f = fakeHerdr()
  const calls: string[] = []
  const h = new Proxy(f.h as Record<string, unknown>, {
    get: (o, name: string) =>
      typeof o[name] === 'function' ? (...a: unknown[]) => (calls.push(name), (o[name] as (...x: unknown[]) => unknown)(...a)) : o[name],
  })
  return { herdr: { ...f, h } as typeof f, calls }
}

const refusals = async (w: ReturnType<typeof world>, id: string, calls: string[], sent: unknown[], state: string) => {
  const key = `${id}/Agent`
  const before = { calls: calls.length, sent: sent.length }
  const said = [
    await w.engine.tell(id, 'hello').catch((e: Error) => e.message),
    await w.engine.restart(id, { kind: 'claude' }).catch((e: Error) => e.message),
    (w.agents as never as { taskEnded: (k: string) => string | undefined }).taskEnded(key),
  ]
  for (const s of said) expect(s).toContain(`Done already (${state})`)
  expect(calls.length).toBe(before.calls)
  expect(sent.length).toBe(before.sent)
}

test('a merged task: tell, restart and a send are refused by state, with zero herdr calls', async () => {
  const c = counted()
  const w = world(c.herdr)
  const { t } = await started(w, repo(), 'merged-route')
  writeFileSync(join(t.worktree as string, 'hello.txt'), 'hello\n')
  sh('git add -A && git commit -qm hello', t.worktree as string)
  await w.engine.done(t.id, 'Added hello.txt.')
  expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
  await refusals(w, t.id, c.calls, w.sent, 'merged')
})

test('a closed task: the same refusals, naming that nothing was merged', async () => {
  const c = counted()
  const w = world(c.herdr)
  const { t } = await started(w, repo(), 'closed-route')
  await w.engine.close(t.id)
  await refusals(w, t.id, c.calls, w.sent, 'nothing to merge')
})

test('the real send path refuses a done task before it opens a connection to herdr', async () => {
  const c = counted()
  const w = world(c.herdr)
  const { t } = await started(w, repo(), 'send-route')
  await w.engine.close(t.id)
  let connections = 0
  const sock = join(process.env.LINECLEAR_HOME as string, 'count.sock')
  const server = createServer((s) => (connections++, s.destroy())).listen(sock)
  const was = process.env.HERDR_SOCKET_PATH
  process.env.HERDR_SOCKET_PATH = sock
  try {
    const { Agents } = await import('../server/live/agents.ts')
    const real = new Agents()
    real.taskEnded = (w.agents as never as { taskEnded: typeof real.taskEnded }).taskEnded
    await expect(real.send(`${t.id}/Agent`, 'hello', { cid: 'c1' })).rejects.toThrow('Done already (nothing to merge)')
    expect(connections).toBe(0)
  } finally {
    process.env.HERDR_SOCKET_PATH = was
    server.close()
  }
})
