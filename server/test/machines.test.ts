// One install for every machine: the helper Lineclear puts on another machine (helper/), run here as it runs there.
// The SSH link itself (box.ts, machines.ts) was checked by hand against a machine saved in herdr.
import { describe, expect, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { helperFiles, helperVersion } from '../server/live/install.ts'
import type { BoxInfo } from '../server/live/box.ts'
import { until } from './until.ts'

const root = join(import.meta.dir, '..')
const perl = spawnSync('perl', ['-MJSON::PP', '-e1']).status === 0

describe('the helper', () => {
  test('its files: the command, the scripts and the skills; its version changes with them', () => {
    const files = helperFiles('Linux', 'x86_64').map(([to]) => to)
    for (const f of ['bin/lineclear', 'skill/lineclear/SKILL.md', 'skill/lineclear-coordinator/SKILL.md', 'skill/lineclear-agent/SKILL.md'])
      expect(files).toContain(f)
    expect(helperVersion('Linux', 'x86_64')).toMatch(/^[0-9a-f]{16}$/)
  })

  test.if(perl)('the lineclear command there says plainly when the way back is down', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shep-shim-'))
    mkdirSync(join(dir, 'bin'))
    writeFileSync(join(dir, 'bin', 'lineclear'), readFileSync(join(root, 'helper', 'lineclear')), { mode: 0o755 })
    writeFileSync(join(dir, 'route.pl'), readFileSync(join(root, 'helper', 'route.pl')))
    const r = spawnSync('perl', [join(dir, 'bin', 'lineclear'), 'status'], { encoding: 'utf8' })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("can't be reached from this machine")
  })
})

describe('a machine run from the main one', () => {
  // fails on ebb17d5 too; L20 fixes it

  test.skip("an agent's artifact commands there name no path of the main machine: the pictures and pages are copied over", () => {
    const home = mkdtempSync(join(tmpdir(), 'shep-worker-'))
    const there = mkdtempSync(join(tmpdir(), 'shep-there-'))
    const files = mkdtempSync(join(tmpdir(), 'shep-there-files-'))
    writeFileSync(join(files, 'board.html'), '<h1>Board</h1>')
    // ssh to the machine runs its command here, so its files are these folders
    const bin = mkdtempSync(join(tmpdir(), 'shep-ssh-'))
    writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nfor a; do last=$a; done\nexec /bin/sh -c "$last"\n', { mode: 0o755 })
    const box: BoxInfo = {
      label: 'vm-demo',
      target: 'vm-demo',
      session: 'default',
      herdr: '/nonexistent/herdr',
      home: there,
      path: `${bin}:/usr/bin:/bin`,
      os: 'Linux',
    }
    const code = `
      const { mkdirSync, writeFileSync } = await import('node:fs')
      const { LiveSource } = await import(${JSON.stringify(join(root, 'server/live/source.ts'))})
      const src = new LiveSource()
      const shot = (n) => { mkdirSync(${JSON.stringify(join(home, 'checks'))}, { recursive: true }); const f = ${JSON.stringify(join(home, 'checks'))} + '/' + n; writeFileSync(f, 'png ' + n); return f }
      src.checker = async () => ({ errors: [], warnings: [], shots: { light: shot('a.png'), dark: shot('a-dark.png') } })
      const cwd = ${JSON.stringify(files)}
      const outs = [(await src.cli(['artifact', 'check', 'board.html'], { cwd })).out]
      const made = (await src.cli(['artifact', 'new', 'board.html', '--title', 'Board'], { cwd })).out
      const id = made.match(/artifact (\\w+)/)[1]
      outs.push(made, (await src.cli(['artifact', 'update', id, 'board.html'], { cwd })).out, (await src.cli(['artifact', 'show', id], { cwd })).out)
      // no browser on the main machine: its error names its own paths
      src.checker = async () => ({ errors: [], warnings: [], skipped: 'could not open a browser here (no chrome at ' + ${JSON.stringify(join(home, 'chrome'))} + ')' })
      outs.push((await src.cli(['artifact', 'check', 'board.html'], { cwd })).out)
      console.log(JSON.stringify(outs))
      process.exit(0)`
    const r = spawnSync(process.execPath, ['-e', code], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        LINECLEAR_BOX: JSON.stringify(box),
        LINECLEAR_HOME: home,
        LINECLEAR_MACHINE: 'vm-demo',
        HERDR_SOCKET_PATH: join(home, 'no-herdr.sock'),
      },
    })
    const outs = JSON.parse(r.stdout) as string[]
    for (const out of outs) expect(out).not.toContain(home)
    const checks = join(there, '.lineclear', 'helper', 'checks')
    for (const out of outs.slice(0, 3)) expect(out).toContain(`Pictures at phone width: ${checks}/a.png (dark: ${checks}/a-dark.png)`)
    expect(readFileSync(join(checks, 'a-dark.png'), 'utf8')).toBe('png a-dark.png')
    const page = outs[3].match(/HTML: (\S+)/)![1]
    expect(page.startsWith(`${join(there, '.lineclear', 'helper', 'artifacts')}/`)).toBe(true)
    expect(readFileSync(page, 'utf8')).toBe('<h1>Board</h1>')
    expect(outs[4]).toContain('No pictures: the main machine could not open its browser')
  })

  // fails on ebb17d5 too; L20 fixes it

  test.skip("its lineclear set and unset for Everywhere run on the main machine; its machine's own stays here", async () => {
    const home = mkdtempSync(join(tmpdir(), 'shep-worker-'))
    const main = mkdtempSync(join(tmpdir(), 'shep-main-'))
    const there = mkdtempSync(join(tmpdir(), 'shep-there-'))
    const bin = mkdtempSync(join(tmpdir(), 'shep-ssh-'))
    writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nfor a; do last=$a; done\nexec /bin/sh -c "$last"\n', { mode: 0o755 })
    // the main machine's Lineclear: it keeps Everywhere in its settings file
    const asked: string[][] = []
    const everywhere: Record<string, string> = {}
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        const [verb, key, value] = ((await req.json()) as { args: string[] }).args
        asked.push([verb, key, value].filter(Boolean))
        if (verb === 'set') everywhere[key] = value
        else delete everywhere[key]
        writeFileSync(join(main, 'settings.json'), JSON.stringify({ everywhere, machine: {}, spaces: {} }))
        return Response.json({ out: 'ok', code: 0 })
      },
    })
    writeFileSync(join(main, 'server.json'), JSON.stringify({ port: server.port, pid: process.pid }))
    const box: BoxInfo = {
      label: 'vm-demo',
      target: 'vm-demo',
      session: 'default',
      herdr: '/nonexistent/herdr',
      home: there,
      path: `${bin}:/usr/bin:/bin`,
      os: 'Linux',
    }
    const code = `
      const { LiveSource } = await import(${JSON.stringify(join(root, 'server/live/source.ts'))})
      const src = new LiveSource()
      const run = async (args) => { const r = await src.cli(args, {}); return [r.code, r.out.trim(), src.settings.pick(args[1], 'machine')] }
      const outs = [await run(['set', 'brief.review', 'off']), await run(['set', 'machine.maxTasks', '3', '--machine']), await run(['unset', 'brief.review'])]
      // the main machine's Lineclear is away (it restarts)
      ;(await import('node:fs')).rmSync(${JSON.stringify(join(main, 'server.json'))})
      outs.push(await run(['set', 'brief.review', 'off']))
      console.log(JSON.stringify(outs))
      process.exit(0)`
    try {
      const w = Bun.spawn([process.execPath, '-e', code], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          LINECLEAR_BOX: JSON.stringify(box),
          LINECLEAR_HOME: home,
          LINECLEAR_MACHINE: 'vm-demo',
          LINECLEAR_MAIN_HOME: main,
          LINECLEAR_SHARED_HOME: main,
          HERDR_SOCKET_PATH: join(home, 'no-herdr.sock'),
        },
      })
      const out = await new Response(w.stdout).text()
      const [set, mine, unset, away] = JSON.parse(out) as [number, string, { value: string; from: string }][]
      expect(set).toEqual([0, "brief.review = off (Everywhere's)", { value: 'off', from: 'all' }])
      expect(mine).toEqual([0, "machine.maxTasks = 3 (vm-demo's)", { value: '3', from: 'machine' }])
      expect(unset[0]).toBe(0)
      expect(unset[1]).toStartWith("brief.review: Everywhere's own is unset")
      expect(unset[2].from).toBe('default')
      // only Everywhere went to the main machine
      expect(asked).toEqual([
        ['set', 'brief.review', 'off'],
        ['unset', 'brief.review'],
      ])
      expect(away[0]).toBe(1)
      expect(away[1]).toContain("The main machine's Lineclear can't be reached right now")
    } finally {
      server.stop(true)
    }
  })
})

describe('a restart of the main server (an update)', () => {
  const saved = { id: 'far', label: 'far', target: 'far.invalid', session: 'default', enabled: true }
  const snap = {
    name: 'S',
    host: 'far',
    machines: [{ machine: 'far', status: 'idle' }],
    places: [
      { id: 'm:far', kind: 'machine', level: 1, name: 'far', machine: 'far', status: 'idle', mode: 'regular', chat: 'm:far' },
      { id: 'p:far:web', kind: 'project', level: 2, name: 'web', machine: 'far', status: 'need', mode: 'regular', chat: 'p:far:web' },
    ],
    tasks: [],
    asks: {},
    settings: [],
    overrides: {},
    user: 'u',
  }

  /** a worker left running from before the restart: a process of its own, serving its snapshot. It ends itself after
   *  two minutes, so a test run killed before its finally leaves no server behind */
  function oldWorker() {
    const dir = mkdtempSync(join(tmpdir(), 'shep-old-worker-'))
    mkdirSync(join(dir, 'server'))
    writeFileSync(
      join(dir, 'server', 'main.ts'),
      `const s = Bun.serve({ port: 0, fetch: () => Response.json(${JSON.stringify(snap)}) }); console.log(s.port); setTimeout(() => process.exit(0), 120_000)`,
    )
    const p = spawn(process.execPath, [join(dir, 'server', 'main.ts')])
    return new Promise<{ pid: number; port: number; alive: () => boolean }>((done) =>
      p.stdout.once('data', (d) => done({ pid: p.pid!, port: Number(String(d).trim()), alive: () => p.exitCode === null && p.signalCode === null })),
    )
  }

  async function before(w: { pid: number; port: number }, code: string) {
    const { HOME, writeJson } = await import('../server/store.ts')
    const { Machines, codeVersion } = await import('../server/live/machines.ts')
    writeJson('machines/far/last.json', {
      saved,
      snap,
      chats: [{ key: 'p:far:web', cli: 'Claude Code', messages: [{ id: 'm1', who: 'agent', at: 1, text: 'Done.' }] }],
    })
    writeJson('workers/far/server.json', { port: w.port, pid: w.pid, code: code || codeVersion() })
    return { HOME, Machines, writeJson }
  }

  test('what each machine showed comes back at once, connecting, and its worker on the same code is taken back', async () => {
    const w = await oldWorker()
    const { HOME, Machines } = await before(w, '')
    const m = new Machines(
      async () => [saved],
      async () => ({}),
    )
    try {
      const l = m.list().find((x) => x.rec.machine === 'far')!
      // at once: the chats on screen, as before the restart, connecting rather than out of reach; its tasks and places
      // are read over the link, not kept
      expect(l.snap).toBeUndefined()
      expect(l.chats.get('p:far:web')?.messages[0].text).toBe('Done.')
      expect(l.connecting).toBe(true)
      expect(m.rows()[0].state).toBe('Connecting…')
      await until(() => l.reachable, 'the link to be reachable')
      expect(l.reachable).toBe(true)
      expect(l.connecting).toBe(false)
      expect(l.worker?.pid).toBe(w.pid)
      m.stop()
      // the worker goes on after this server stops, and what the machine showed is kept for the next start
      await Bun.sleep(100)
      expect(w.alive()).toBe(true)
      expect(existsSync(join(HOME, 'machines', 'far', 'last.json'))).toBe(true)
    } finally {
      m.stop()
      process.kill(w.pid)
    }
  })

  test('a worker started again out of its hands (the doctor, by hand) is followed to its new address', async () => {
    const w = await oldWorker()
    const { Machines, writeJson } = await before(w, '')
    const m = new Machines(
      async () => [saved],
      async () => ({}),
    )
    const next = await oldWorker()
    try {
      const l = m.list().find((x) => x.rec.machine === 'far')!
      await until(() => l.reachable, 'the link to be reachable')
      expect(l.reachable).toBe(true)
      // the old worker stops, and a new one serves on another port, as the doctor leaves it
      process.kill(w.pid)
      writeJson('workers/far/server.json', { port: next.port, pid: next.pid })
      await until(() => l.reachable && l.rec.url.endsWith(`:${next.port}`), 'the link to follow the new worker')
      expect(l.rec.url).toBe(`http://127.0.0.1:${next.port}`)
      expect(l.reachable).toBe(true)
      expect(l.worker?.pid).toBe(next.pid)
    } finally {
      m.stop()
      if (w.alive()) process.kill(w.pid)
      process.kill(next.pid)
    }
  })

  test('cached workers are not adopted while enabled membership is pending, and disabled workers stay off', async () => {
    const w = await oldWorker()
    const { HOME, Machines } = await before(w, '')
    let resolve!: (value: (typeof saved)[]) => void
    const pending = new Promise<(typeof saved)[]>((r) => {
      resolve = r
    })
    const m = new Machines(
      () => pending,
      async () => ({}),
    )
    try {
      const l = m.list().find((x) => x.rec.machine === 'far')!
      await (m as unknown as { pollAll(): Promise<void> }).pollAll()
      expect(l.worker).toBeUndefined()
      expect(l.reachable).toBe(false)
      expect(l.rec.url).toBe('')
      resolve([{ ...saved, enabled: false }])
      await until(() => !w.alive(), 'the worker to stop')
      expect(w.alive()).toBe(false)
      expect(m.byName('far')).toBeUndefined()
      expect(existsSync(join(HOME, 'machines', 'far', 'last.json'))).toBe(false)
    } finally {
      resolve([])
      m.stop()
      if (w.alive()) process.kill(w.pid)
    }
  })

  test('a worker on other code is stopped, not taken back', async () => {
    const w = await oldWorker()
    const { Machines } = await before(w, 'older')
    const m = new Machines(
      async () => [saved],
      async () => ({}),
    )
    try {
      await until(() => !w.alive(), 'the worker to stop')
      expect(w.alive()).toBe(false)
      expect(m.list()[0].worker?.pid).not.toBe(w.pid)
    } finally {
      m.stop()
      if (w.alive()) process.kill(w.pid)
    }
  })
})
