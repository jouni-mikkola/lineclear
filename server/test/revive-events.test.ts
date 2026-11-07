// Agents revive on herdr's events: a pane's process is compared once when it appears (a start, herdr back) or when herdr
// says its CLI exited, never on a timer; a revival waits out its grace as a deadline.
import { describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LINECLEAR_HOME = mkdtempSync(join(tmpdir(), 'shep-revive-events-'))
const { Agents } = await import('../server/live/agents.ts')
const { herdr } = await import('../server/live/herdr.ts')
const { Revivals } = await import('../server/live/revive.ts')

const N = 45
const keys = Array.from({ length: N }, (_, i) => `t${i}/Agent`)
const listing = (pane: (i: number) => string) =>
  keys.map((_, i) => ({
    agent: 'pi',
    agent_status: 'idle',
    name: `shep-t${i}`,
    pane_id: pane(i),
    tab_id: 't',
    workspace_id: 'w',
    cwd: null,
    interactive_ready: true,
  }))

function fixture() {
  const a = new Agents()
  // never started: no subscription, no timers
  const loose = a as unknown as {
    records: Record<string, unknown>
    byName: Map<string, string>
    take(l: unknown): void
    heard(e: unknown): void
    filesOf: () => object
  }
  loose.filesOf = () => ({})
  // route binding reads a pane's process too, for its own reasons (agent-routes.ts)
  ;(a as unknown as { routes: { repair(): Promise<void> } }).routes.repair = async () => undefined
  keys.forEach((key, i) => {
    loose.records[key] = { key, name: `shep-t${i}`, kind: 'pi', finished: false }
    loose.byName.set(`shep-t${i}`, key)
  })
  return { a, loose }
}

const tree = (argv: string[]) => ({ shell_pid: 1, foreground_process_group_id: 2, foreground_processes: [{ argv }] }) as never

describe('revive on herdr events', () => {
  test('45 agents in a quiet minute: one compare each when they appear, none after', async () => {
    const { a, loose } = fixture()
    const calls = spyOn(herdr, 'processInfo').mockImplementation(async () => tree(['pi']))
    try {
      loose.take(listing((i) => `w:p${i}`))
      expect(a.suspects).toBe(true)
      for (const k of keys) expect(await a.wrong(k)).toBeUndefined()
      expect(calls).toHaveBeenCalledTimes(N)
      // a quiet minute: the passes of the old timer would have asked 180 times
      for (let pass = 0; pass < 4; pass++) for (const k of keys) await a.wrong(k)
      expect(calls).toHaveBeenCalledTimes(N)
      expect(a.suspects).toBe(false)

      // herdr restarts: the panes are new, each compared once
      loose.take(listing((i) => `w2:p${i}`))
      for (let pass = 0; pass < 4; pass++) for (const k of keys) await a.wrong(k)
      expect(calls).toHaveBeenCalledTimes(2 * N)
    } finally {
      calls.mockRestore()
    }
  })

  test('pane.exited makes one compare that finds the shell at its prompt', async () => {
    const { a, loose } = fixture()
    let argv = ['pi']
    const calls = spyOn(herdr, 'processInfo').mockImplementation(async () =>
      argv.length ? tree(argv) : ({ shell_pid: 2, foreground_process_group_id: 2 } as never),
    )
    try {
      loose.take(listing((i) => `w:p${i}`))
      for (const k of keys) await a.wrong(k)
      calls.mockClear()
      argv = []
      let told = 0
      a.onSuspect = () => told++
      loose.heard({ event: 'pane_exited', data: { pane_id: 'w:p3' } })
      expect(told).toBe(1)
      expect(await a.wrong('t3/Agent')).toBe('exited')
      expect(await a.wrong('t3/Agent')).toBe('exited')
      expect(await a.wrong('t4/Agent')).toBeUndefined()
      expect(calls).toHaveBeenCalledTimes(1)
    } finally {
      calls.mockRestore()
    }
  })

  test('a revival is due at its grace deadline, and no sooner', () => {
    const r = new Revivals()
    expect(r.seen('k', 1000)).toBeUndefined()
    expect(r.wait('k', 1000)).toBe(20_000)
    expect(r.seen('k', 20_999)).toBeUndefined()
    expect(r.wait('k', 20_999)).toBe(1)
    expect(r.seen('k', 21_000)).toBe('go')
  })

  test('an agent killed three times in an hour is restarted after the grace each time, then left', () => {
    const r = new Revivals()
    const starts: number[] = []
    for (let t = 0; t <= 3_600_000 && starts.length < 3; t += 1000) {
      if (r.seen('k', t) === 'go') starts.push(t)
    }
    expect(starts[0]).toBe(20_000)
    expect(starts.length).toBe(3)
    const last = starts[2]
    expect(r.seen('k', last + 1000)).toBeUndefined()
    expect(r.seen('k', last + 21_000)).toBe('give-up')
    for (let t = last + 22_000; t < 3_600_000; t += 1000) expect(r.seen('k', t)).toBeUndefined()
  })

  test('an RPC agent is never compared through herdr', async () => {
    const { a, loose } = fixture()
    const calls = spyOn(herdr, 'processInfo').mockImplementation(async () => tree(['pi']))
    try {
      ;(a as unknown as { rpcs: Map<string, unknown> }).rpcs.set('t0/Agent', {})
      loose.take(listing((i) => `w:p${i}`))
      expect(await a.wrong('t0/Agent')).toBeUndefined()
      expect(calls).not.toHaveBeenCalled()
    } finally {
      calls.mockRestore()
    }
  })
})
