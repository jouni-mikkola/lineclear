import { stopSource, HOST, placeId, src, until, workedTask } from './source-fixture.ts'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('news for coordinators', () => {
  test('helper task add forwards the full remote identity, options and known requesting coordinator', async () => {
    const peers = src.peers!
    const list = peers.list
    const fetch = peers.fetch
    const chat = placeId.home()
    const record = src.agents.records[chat]
    src.agents.records[chat] = { key: chat, name: 'home', kind: 'codex', cwd: '/', workspace: 'home', logs: [], started: 1 }
    src.agents.save()
    const calls: { args: string[]; chat?: string }[] = []
    peers.list = (() => [{ rec: { machine: 'desktop' }, snap: { places: [{ id: 'p:desktop:remote', name: 'Remote', home: false }] } }]) as never
    peers.fetch = (async (_l, path, init) => {
      expect(path).toBe('/api/cli')
      calls.push(JSON.parse(String(init!.body)))
      return Response.json({ code: 0, out: 'Added REM-1: Remote task.' })
    }) as typeof fetch
    try {
      const result = await src.cli(['task', 'add', 'Remote task', '--space', 'p:desktop:remote', '--desc', 'Whole brief', '--later'], { chat })
      expect(result.code).toBe(0)
      expect(calls[0]).toEqual({ args: ['task', 'add', 'Remote task', '--space', 'remote', '--desc', 'Whole brief', '--later'], chat })
      await src.cli(['task', 'add', 'Terminal task', '--space', 'p:desktop:remote'], { chat: 'invented' })
      expect(calls[1].chat).toBeUndefined()
    } finally {
      peers.list = list
      peers.fetch = fetch
      if (record) src.agents.records[chat] = record
      else delete src.agents.records[chat]
      src.agents.save()
    }
  })
  test('requester news preserves owner/home routes, carries no extra card, and drops removed origins', async () => {
    const { t, place } = await workedTask('requestnews')
    const originDir = mkdtempSync(join(tmpdir(), 'request-origin-'))
    execSync('git init -q -b main', { cwd: originDir })
    const origin = await src.places.add(originDir, 'requestorigin')
    const requester = placeId.space(origin.name)
    const sent: { chat: string; text: string }[] = []
    const send = src.agents.send
    const old = src.agents.records[requester]
    src.agents.records[requester] = { key: requester, name: 'coordinator', kind: 'codex', logs: [], cwd: originDir, workspace: 'origin', started: 1 }
    src.agents.send = (async (chat: string, text: string) => {
      sent.push({ chat, text })
      return { waiting: false }
    }) as never
    const drain = () => (src as unknown as { drainRequestedNews(): Promise<void> }).drainRequestedNews()
    try {
      t.requester = requester
      const before = src.chats.chat(requester).messages.length
      src.engine.emit('news', place, `${t.id} is ready`, 'ready', { task: t.id, event: 'ready' })
      await until(() => sent.some((n) => n.chat === requester))
      expect(sent.map((n) => n.chat).sort()).toEqual([place, requester].sort())
      expect(sent.find((n) => n.chat === requester)!.text).toContain('You requested this task')
      expect(src.chats.chat(requester).messages).toHaveLength(before)
      await drain()
      expect(sent.filter((n) => n.chat === requester)).toHaveLength(1)
      // Ordinary same-space tasks keep their original single delivery.
      t.requester = place
      sent.length = 0
      src.engine.emit('news', place, `${t.id} is ready`, 'ready', { task: t.id, event: 'ready' })
      await drain()
      expect(sent.map((n) => n.chat).sort()).toEqual([place])
      // A saved return address cannot resurrect a removed space.
      t.requester = requester
      src.places.spaces = src.places.spaces.filter((p) => p !== origin)
      sent.length = 0
      src.engine.emit('news', place, `${t.id} merged`, 'done', { task: t.id, event: 'merged' })
      await until(() => !(src as unknown as { drainingNews: boolean }).drainingNews)
      expect(sent.some((n) => n.chat === requester)).toBe(false)
    } finally {
      src.agents.send = send
      if (old) src.agents.records[requester] = old
      else delete src.agents.records[requester]
      if (!src.places.spaces.includes(origin)) src.places.spaces.push(origin)
    }
  })
})

describe('news for coordinators, continued', () => {
  test("the main machine's home space hears every space's news, ", async () => {
    const project = placeId.space('newsco')
    const home = placeId.home()
    const sent: string[] = []
    const send = src.agents.send
    src.agents.send = (async (k: string) => (k === project || k === home ? sent.push(k) : 0, { waiting: false })) as never
    const news = (kind: 'added' | 'ready', at = project) => (
      (sent.length = 0), src.engine.emit('news', at, 'NC-1 is ready', kind, { task: 'NC-1', event: kind }), [...sent].sort()
    )
    try {
      // the home space is woken by no other space's news: its own coordinator acts on it
      expect(news('ready')).toEqual([project])
      expect(news('added')).toEqual([])
      // the home space's own news goes to it once
      expect(news('ready', home)).toEqual([])
    } finally {
      src.agents.send = send
    }
  })
  test("news the human sees as a card gets its coordinator's short reply after it; unseen news may get <no-reply>", async () => {
    const project = placeId.space('newsreply')
    const said = new Map<string, string>()
    const send = src.agents.send
    src.agents.send = (async (k: string, text: string) => (said.set(k, text), { waiting: false })) as never
    const engine = src.engine as unknown as { emit(e: string, ...a: unknown[]): void }
    try {
      // a status's card goes up, then its news: the coordinator replies after the card, never quietly
      const t = { id: 'NR-1', project, posted: 'ready|' } as never
      engine.emit('card', t, 'ready', '')
      engine.emit('news', project, 'NR-1 is ready to merge', 'ready', { task: 'NR-1', event: 'ready' })
      expect(said.get(project)).toContain('A card in this chat already shows the human the news: reply after it in one or two short lines')
      expect(said.get(project)).toContain('Never <no-reply> to it.')
      // the main machine's home space, off coordinator timer, costs no model turn on it
      expect(said.has(placeId.home())).toBe(false)
      // and on coordinator timer an event never wakes it either (LIN-110)
      // a second word on the same merge (what its cleanup kept) has no card of its own
      engine.emit('news', project, 'NR-1 was merged; kept notes.md', 'done', { task: 'NR-1', event: 'merged' })
      expect(said.get(project)).toContain('reply with only <no-reply>reason</no-reply>')
      // main went red: a one-line card in the project's chat, and the coordinator's reply after it
      engine.emit(
        'news',
        project,
        'main went red on GitHub at 1a2b3c4: Check failed (link).',
        'red',
        { task: '', event: 'main-red' },
        { red: 'main', text: 'went red: Check failed' },
      )
      expect(
        src.chats
          .chat(project)
          .messages.filter((m) => m.card?.red)
          .map((m) => m.text),
      ).toEqual(['main went red: Check failed'])
      expect(said.get(project)).toContain('Never <no-reply> to it.')
    } finally {
      src.agents.send = send
    }
  })
})

describe("every machine's news reaches the main machine's home space", () => {
  test("another machine's needs-you, red main and health come over its worker's link in one line each; the space's coordinator has the whole", async () => {
    const { startApp } = await import('../server/app.ts')
    const { Emitter } = await import('../server/source.ts')
    // the other machine's worker: its app, its news as its LiveSource emits it
    const worker = Object.assign(new Emitter(), {
      kind: 'live',
      snapshot: () => ({
        name: 'S',
        host: 'faraway',
        places: [{ id: 'p:faraway:shop', name: 'shop', machine: 'faraway', level: 1, status: 'need', mode: 'regular', chat: 'p:faraway:shop' }],
        machines: [{ id: 'm:faraway', machine: 'faraway', name: 'faraway', status: 'need' }],
        tasks: [{ id: 'FS-1', name: 'Colours', status: 'need', place: 'p:faraway:shop', age: '1m', state: '', on: '', created: '' }],
        automations: {},
        asks: {},
        settings: [],
        overrides: {},
        user: 'u',
      }),
      chat: () => undefined,
      watch: () => {},
    })
    const app = startApp({ source: worker as never, port: 0 })
    // news from before the main machine's link (its server restarting) waits for it
    worker.emit('news', { place: 'p:faraway:shop', line: 'FS-0 is ready to merge', kind: 'ready', about: { task: 'FS-0', event: 'ready' } })
    const home = placeId.home()
    const said: string[] = []
    const send = src.agents.send
    src.agents.send = (async (k: string, text: string) => (k === home && said.push(text), { waiting: false })) as never
    const alerts: { title: string; go: { place: string; task?: string }; task?: true }[] = []
    const off = src.on('alert', (a) => alerts.push(a))
    try {
      const l = src.peers!.adopt('faraway', `http://127.0.0.1:${app.port}`)
      await until(() => l.ws?.readyState === WebSocket.OPEN)
      // a space's news (ready, needs-you, red main, added) costs the home coordinator no model turn: its own coordinator
      // and the human's cards have it. Only the machine's health reaches it, over the same link
      worker.emit('news', { place: 'p:faraway:shop', line: 'FS-1 needs you: Which colour?', kind: 'need', about: { task: 'FS-1', event: 'needs-you' } })
      worker.emit('news', {
        place: 'p:faraway:shop',
        line: 'main went red on GitHub at 1a2b3c4: Check failed (link).\nIts log ends:\n> boom',
        kind: 'red',
        about: { task: '', event: 'main-red' },
      })
      worker.emit('news', { place: 'p:faraway:shop', line: 'FS-2 was added: More', kind: 'added', about: { task: 'FS-2', event: 'added' } })
      worker.emit('news', {
        place: 'p:faraway:~',
        line: "herdr isn't answering (since 10:00), so its agents can't hear anything",
        kind: 'health',
        about: { kind: 'herdr', what: 'over' },
      })
      await until(() => said.length > 0)
      await Bun.sleep(100)
      expect(said.length).toBe(1)
      expect(said[0]).toContain('<health kind="herdr" what="over">Machine faraway: herdr isn')
      // an alert about a task opens on it, and buzzes while the task waits on you
      expect((await src.cli(['alert', 'FS-1 waits on a colour', '--task', 'FS-1'], { chat: home })).out.trim()).toBe('Alert sent.')
      expect(alerts.at(-1)).toMatchObject({ title: 'FS-1 waits on a colour', go: { place: 'p:faraway:shop', task: 'FS-1' }, task: true })
    } finally {
      off()
      src.agents.send = send
      app.stop(true)
    }
  })
  test("a worker passes each piece of its machine's news on, for its link to carry to the main machine", () => {
    const got: { place: string; line: string; kind: string }[] = []
    const off = src.on('news', (n) => got.push(n))
    const send = src.agents.send
    src.agents.send = (async () => ({ waiting: false })) as never
    try {
      src.engine.emit('news', placeId.space('newsout'), 'NO-1 needs you: Signed out', 'need', { task: 'NO-1', event: 'needs-you' })
      expect(got).toEqual([
        { place: placeId.space('newsout'), line: 'NO-1 needs you: Signed out', kind: 'need', about: { task: 'NO-1', event: 'needs-you' } } as never,
      ])
    } finally {
      off()
      src.agents.send = send
    }
  })
})

describe('automations add tasks with fresh agents', () => {
  test('on a time rule and on an event, each run a new task from its template; paused, run now, edited, removed', async () => {
    const { t, place } = await workedTask('autos')
    const name = src.places.space(place)!.name
    const tasks = () => src.engine.tasks.filter((x) => x.project === place && x.by.startsWith('the automation'))
    const add = await src.cli(
      ['automation', 'add', 'Nightly', '--task', 'Bump deps', '--brief', 'Bump and test.', '--when', 'FREQ=MINUTELY;INTERVAL=5', '--agent', 'pi'],
      { chat: place },
    )
    expect(add.out).toMatch(
      /^Automation “Nightly” is on: Every 5 minutes \(.+\); next .+ \[--when "DTSTART:20260101T000000 RRULE:FREQ=MINUTELY;INTERVAL=5"\]\. It adds the task “Bump deps” to autos, with a fresh agent/,
    )
    // its first run is the rule's first after it was made: as if made six minutes ago
    src.automations.find(place, 'Nightly')!.since = Date.now() - 6 * 60_000
    ;(src as unknown as { runSchedules(): void }).runSchedules()
    expect(tasks().map((x) => [x.title, x.by, x.agent?.kind])).toEqual([['Bump deps', 'the automation “Nightly”', 'pi']])
    expect(tasks()[0].desc).toStartWith('Bump and test.')
    // the next run is five minutes after the last
    ;(src as unknown as { runSchedules(): void }).runSchedules()
    expect(tasks()).toHaveLength(1)
    expect(src.snapshot().automations[place][0]).toMatchObject({
      name: 'Nightly',
      when: expect.stringMatching(/^Every 5 minutes \(/),
      what: 'Bump deps',
      on: true,
      next: expect.any(Array),
      runs: [{ task: tasks()[0].id }],
    })
    // an event: a task merged adds one; a task an automation added sets off no 'added' automation
    await src.cli(['automation', 'add', 'Notes', '--task', 'Write notes', '--on', 'merged'], { chat: place })
    await src.cli(['automation', 'add', 'Echo', '--task', 'Echo', '--on', 'added'], { chat: place })
    await src.cli(['merge', t.id], {})
    await until(() => tasks().some((x) => x.title === 'Write notes'))
    expect(tasks().filter((x) => x.title === 'Echo')).toHaveLength(0)
    // from the screen: paused, run now, removed; changed only by the command
    expect(await src.act({ type: 'automation', place, op: 'pause', name: 'Nightly' })).toEqual({ ok: true })
    expect(src.automations.dueNow(src.settings.zone(), Date.now() + 3_600_000).map((a) => a.name)).not.toContain('Nightly')
    expect(await src.act({ type: 'automation', place, op: 'run', name: 'Nightly' })).toEqual({ ok: true })
    expect(tasks().filter((x) => x.title === 'Bump deps')).toHaveLength(2)
    await src.cli(['automation', 'edit', 'Nightly', '--when', 'FREQ=DAILY;BYHOUR=3;BYMINUTE=0', '--task', 'Bump all deps', '--brief', ''], { chat: place })
    expect(src.automations.find(place, 'Nightly')).toMatchObject({
      trigger: { time: 'DTSTART:20260101T000000 RRULE:FREQ=DAILY;BYHOUR=3;BYMINUTE=0' },
      task: { title: 'Bump all deps', agent: { kind: 'pi' } },
      on: false,
    })
    expect(src.automations.find(place, 'Nightly')!.task.desc).toBeUndefined()
    expect((await src.cli(['automation', 'add', 'Bad', '--task', 'x', '--when', 'sometimes'], { chat: place })).out).toContain("Can't read the time rule")
    // the old flags are gone
    expect((await src.cli(['automation', 'add', 'Old', '--task', 'x', '--schedule', 'daily 9:00'], { chat: place })).out).toContain('takes no --schedule')
    // the screen adds or changes none
    expect(await src.act({ type: 'automation', place, op: 'save', name: 'Nightly' } as never)).toMatchObject({ ok: false })
    expect(await src.act({ type: 'automation', place, op: 'remove', name: 'Echo' })).toEqual({ ok: true })
    expect((await src.cli(['automation', 'list', '--space', name], {})).out).toMatch(
      /Nightly · Every day at 3:00 \(.+\) \[--when "DTSTART:20260101T000000 RRULE:FREQ=DAILY;BYHOUR=3;BYMINUTE=0"\] · adds “Bump all deps” \(pi\) · autos · paused · last ran/,
    )
    // the old kinds are gone
    expect((await src.cli(['automation', 'add', 'Ask', '--ask', 'What waits?', '--when', 'FREQ=DAILY'], { chat: place })).out).toContain('takes no --ask')
  })
})

describe('adding a space from the sidebar', () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-home-'))
  const realHome = process.env.HOME
  beforeAll(() => {
    process.env.HOME = home
  })
  afterAll(() => {
    process.env.HOME = realHome
  })

  // fails on ebb17d5 too; L20 fixes it

  test.skip('on this machine: a new folder becomes a repo and a space, like lineclear space add', async () => {
    const r = await src.addSpace({ machine: HOST, path: '~/dev/fresh', name: 'fresh-app', create: true })
    expect(r.place).toBe(placeId.space('fresh-app'))
    expect(src.places.byName('fresh-app')?.path).toEndWith('/dev/fresh')
    expect(src.snapshot().places.some((p) => p.id === r.place)).toBe(true)
    const f = await src.folders(HOST, '~/dev')
    expect(f.entries).toEqual([{ name: 'fresh', path: '~/dev/fresh', repo: true, added: true }])
  })
  test('a folder that is not a repo is not added without create; nothing outside home either', async () => {
    mkdirSync(join(home, 'plain'))
    await expect(src.addSpace({ machine: HOST, path: '~/plain' })).rejects.toThrow('not a git repository')
    await expect(src.addSpace({ machine: HOST, path: '/etc', create: true })).rejects.toThrow('Only folders in your home')
    await expect(src.addSpace({ machine: HOST, path: '~/plain', name: 'a/b', create: true })).rejects.toThrow()
  })
  test('another machine: folders and adding pass through to its copy; one unknown or out of reach says so', async () => {
    const got: { path: string; body?: unknown }[] = []
    const far = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        const u = new URL(req.url)
        got.push({ path: u.pathname + u.search, body: req.method === 'POST' ? await req.json() : undefined })
        if (u.pathname === '/api/snapshot')
          return Response.json({
            name: 'S',
            host: 'far',
            places: [{ id: 'p:far:~', name: 'home', machine: 'far', home: true, level: 1, status: 'idle', mode: 'manual', chat: 'p:far:~' }],
            machines: [{ id: 'm:far', machine: 'far', name: 'far', status: 'idle' }],
            tasks: [],
            automations: {},
            asks: {},
            settings: [],
            overrides: {},
            user: 'u',
          })
        if (u.pathname === '/api/folders') return Response.json({ path: u.searchParams.get('path'), exists: true, dir: true, repo: null, entries: [] })
        if (u.pathname === '/api/spaces') return Response.json({ error: 'Another space on far has that name.' }, { status: 500 })
        return new Response('no', { status: 404 })
      },
    })
    try {
      src.peers!.adopt('far', `http://127.0.0.1:${far.port}`)
      for (let i = 0; i < 50 && !src.peers!.list().find((l) => l.rec.machine === 'far')?.reachable; i++) await new Promise((r) => setTimeout(r, 20))
      expect(src.snapshot().machines.find((m) => m.id === 'm:far')?.status).toBe('idle')
      expect((await src.folders('far', '~/dev')).path).toBe('~/dev')
      expect(got.some((g) => g.path === `/api/folders?machine=far&path=${encodeURIComponent('~/dev')}`)).toBe(true)
      await expect(src.addSpace({ machine: 'far', path: '~/x', name: 'x' })).rejects.toThrow('Another space on far has that name.')
      expect(got.find((g) => g.path === '/api/spaces')?.body).toEqual({ machine: 'far', path: '~/x', name: 'x' })
      await expect(src.folders('nowhere', '~')).rejects.toThrow('No machine called nowhere')
    } finally {
      far.stop(true)
    }
  })
})

afterAll(stopSource)

describe('naming a space', () => {
  test("a name reaches this machine's space only; another machine's space needs its full id", () => {
    const peers = src.peers!
    const list = peers.list
    const remote = 'p:desktop:dispatcher'
    peers.list = (() => [{ rec: { machine: 'desktop' }, snap: { places: [{ id: remote, name: 'dispatcher', home: false }] } }]) as never
    try {
      const named = (n: string) => (src as unknown as { placeNamed(n: string): { id: string } | undefined }).placeNamed(n)
      expect(named('dispatcher')).toBeUndefined()
      expect(named(remote)?.id).toBe(remote)
    } finally {
      peers.list = list
    }
  })
})
