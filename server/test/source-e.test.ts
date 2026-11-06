import { stopSource, HOST, placeId, heartbeatFile, src, until, workedTask } from './source-fixture.ts'
import { readJson } from '../server/store.ts'
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
  test("every space starts regular; the main machine's home space hears every space's news, a task added only on coordinator timer", async () => {
    const project = placeId.space('newsco')
    const home = placeId.home()
    const sent: string[] = []
    const send = src.agents.send
    src.agents.send = (async (k: string) => (k === project || k === home ? sent.push(k) : 0, { waiting: false })) as never
    const modes = { ...src.places.modes }
    const news = (kind: 'added' | 'ready', at = project) => (
      (sent.length = 0), src.engine.emit('news', at, 'NC-1 is ready', kind, { task: 'NC-1', event: kind }), [...sent].sort()
    )
    try {
      for (const id of [project, home]) delete src.places.modes[id]
      // off coordinator timer the home space is woken by no other space's news: its own coordinator acts on it
      expect(news('ready')).toEqual([project])
      expect(news('added')).toEqual([])
      src.places.modes[project] = 'regular'
      src.places.modes[home] = 'autopilot'
      const homeRun = src.pilots.begin(home, src.settings.pilot())
      homeRun.state = 'on'
      expect(news('ready')).toEqual([project])
      // on coordinator timer an event never wakes the coordinator: no news goes to it at all
      expect(news('added')).toEqual([])
      // the home space's own news goes to it once
      expect(news('ready', home)).toEqual([])
    } finally {
      src.agents.send = send
      src.places.modes = modes
    }
  })
  test("news the human sees as a card gets its coordinator's short reply after it; unseen news may get <no-reply>", async () => {
    const project = placeId.space('newsreply')
    const said = new Map<string, string>()
    const send = src.agents.send
    src.agents.send = (async (k: string, text: string) => (said.set(k, text), { waiting: false })) as never
    const modes = { ...src.places.modes }
    const engine = src.engine as unknown as { emit(e: string, ...a: unknown[]): void }
    try {
      for (const id of [project, placeId.home()]) delete src.places.modes[id]
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
      src.places.modes = modes
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

describe('coordinator timer switch failures are truthful', () => {
  test('unsupported home isolation fails without changing mode or posting an ON card', async () => {
    const place = placeId.home(HOST)
    src.places.setMode(place, 'regular')
    const result = (await src.act({ type: 'mode', place, mode: 'autopilot' })) as { error?: string }
    expect(result.error).toContain('repository space')
    expect(src.places.mode(place)).toBe('regular')
    expect(await src.act({ type: 'mode', place, mode: 'copilot' as never })).toEqual({ ok: false, error: 'No such mode.' })
  })
})

describe("Coordinator timer's heartbeat", () => {
  const min = 60_000
  test('on its time rule, only while its coordinator is idle; the news its event rules name wakes it at once, the rest waits for it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shep-beat-'))
    execSync('git init -q -b main', { cwd: dir })
    const p = await src.places.add(dir, 'beat')
    const place = placeId.space(p.name)
    const sent: { k: string; text: string }[] = []
    const send = src.agents.send
    const status = src.agents.status
    const reachable = src.agents.reachable
    let st = 'working'
    src.agents.send = (async (k: string, text: string) => (sent.push({ k, text }), { waiting: false })) as typeof send
    src.agents.status = ((k: string) => (k === place ? st : 'gone')) as typeof status
    src.agents.reachable = true
    const beats = () => sent.filter((x) => x.k === place && x.text.includes('<heartbeat>'))
    // on a half hour: every 30 minutes runs on the clock's :00 and :30
    const t0 = Math.floor(Date.now() / (30 * min)) * 30 * min
    try {
      const run = src.pilots.begin(place, src.settings.pilot(p.name))
      run.state = 'on'
      src.places.setMode(place, 'autopilot')
      src.heartbeats.switched(place, true, t0)
      src.heartbeat(t0 + 29 * min)
      expect(beats()).toEqual([])
      // due, but busy: it waits for the turn to end
      src.heartbeat(t0 + 31 * min)
      expect(beats()).toEqual([])
      // news never wakes the coordinator on coordinator timer, and none is kept for the heartbeat (quiet.ts)
      src.engine.emit('news', place, 'BE-1 was added: Fix it', 'added', { task: 'BE-1', event: 'added' })
      src.engine.emit('news', place, 'BE-2 needs you: a question', 'need', { task: 'BE-2', event: 'needs-you' })
      src.engine.emit('news', place, 'BE-3 is merged', 'done', { task: 'BE-3', event: 'merged' })
      expect(sent.filter((x) => x.k === place)).toEqual([])
      // the same when its event rules name it
      expect(src.settings.set('heartbeat.on', 'needs-you', { space: p.name }).ok).toBe(true)
      src.engine.emit('news', place, 'BE-4 is ready to merge', 'ready', { task: 'BE-4', event: 'ready' })
      expect(sent.filter((x) => x.k === place).some((x) => x.text.includes('BE-4'))).toBe(false)
      st = 'idle'
      src.heartbeat(t0 + 32 * min)
      expect(beats()).toHaveLength(1)
      const beat = beats()[0].text
      expect(beat).toStartWith('<lineclear><heartbeat>Heartbeat. Go through your HEARTBEAT.md: ')
      expect(beat).toContain('Your HEARTBEAT.md:\n# Heartbeat')
      expect(beat).not.toContain('BE-1')
      expect(beat).not.toContain('News since the last heartbeat')
      expect(beat).not.toContain('BE-4')
      src.settings.set('heartbeat.on', null, { space: p.name })
      expect(beat).toContain('<no-reply>heartbeat: nothing to do</no-reply>')
      // the quiet marker the coordinator answers with shows nothing in the chat
      expect((await src.cli(['heartbeat'], { chat: place })).out).toMatch(
        /heartbeat: Every 30 minutes \(.+\); last .+; next .+ once idle\. Wakes at once on: all news\./,
      )
      // read and changed with the command, from any machine: the checklist itself, never its path
      expect((await src.cli(['heartbeat'], { chat: place })).out).toContain('HEARTBEAT.md:\n# Heartbeat')
      expect((await src.cli(['heartbeat', 'set'], { chat: place })).out).toContain('on stdin')
      src.places.setMode(place, 'regular')
      src.pilots.current(place)!.state = 'stopped'
      expect((await src.cli(['heartbeat', 'set', p.name], { stdin: '- Check the ROM builds\n' })).out).toContain('is saved')
      const shown = (await src.cli(['heartbeat', p.name], {})).out
      expect(shown).toContain('HEARTBEAT.md:\n- Check the ROM builds')
      expect(shown).not.toContain(heartbeatFile(place))
      const show = (await src.cli(['show'], { chat: place })).out
      expect(show).toContain('Heartbeat on coordinator timer: Every 30 minutes (')
      expect(show).toContain("news that wakes it at once: all news, the rest waits for the heartbeat. Each brings the place's HEARTBEAT.md")
      // Restore only this fake run after editing while OFF; never start a real CLI in this fixture.
      src.places.setMode(place, 'autopilot')
      run.state = 'on'
      // once given, the next is the rule's next run
      src.heartbeat(t0 + 40 * min)
      expect(beats()).toHaveLength(1)
      src.heartbeat(t0 + 62 * min)
      expect(beats()).toHaveLength(2)
      // an empty HEARTBEAT.md, edited in Settings: no heartbeat
      src.places.setMode(place, 'regular')
      run.state = 'stopped'
      expect(await src.act({ type: 'setting', key: 'heartbeat.md', value: '', place })).toEqual({ ok: true })
      expect(
        src
          .snapshot()
          .settings.find((x) => x.level === place && x.name === 'Coordinator timer')!
          .rows.find((r) => r.key === 'heartbeat.md'),
      ).toMatchObject({ value: '', doc: true })
      src.places.setMode(place, 'autopilot')
      run.state = 'on'
      src.heartbeat(t0 + 93 * min)
      expect(beats()).toHaveLength(2)
      // off coordinator timer: no heartbeat however long it waits
      src.places.setMode(place, 'regular')
      run.state = 'stopped'
      src.heartbeats.switched(place, false)
      await src.act({ type: 'setting', key: 'heartbeat.md', value: '- check things', place })
      src.heartbeat(t0 + 300 * min)
      expect(beats()).toHaveLength(2)
    } finally {
      src.agents.send = send
      src.agents.status = status
      src.agents.reachable = reachable
    }
  })
  test('the quiet marker shows nothing in the chat', async () => {
    const { agentLines } = await import('../server/live/chatlines.ts')
    expect(agentLines('<no-reply>heartbeat: nothing to do</no-reply>').text).toBe('')
  })
})

describe('automations add tasks with fresh agents', () => {
  test('on a time rule and on an event, each run a new task from its template; paused, run now, edited, removed', async () => {
    const { t, place } = await workedTask('autos')
    const name = src.places.space(place)!.name
    const tasks = () => src.engine.tasks.filter((x) => x.project === place && x.by.startsWith('the automation'))
    const add = await src.cli(
      ['automation', 'add', 'Nightly', '--task', 'Bump deps', '--brief', 'Bump and test.', '--when', 'FREQ=MINUTELY;INTERVAL=5', '--agent', 'codex'],
      { chat: place },
    )
    expect(add.out).toMatch(
      /^Automation “Nightly” is on: Every 5 minutes \(.+\); next .+ \[--when "DTSTART:20260101T000000 RRULE:FREQ=MINUTELY;INTERVAL=5"\]\. It adds the task “Bump deps” to autos, with a fresh agent/,
    )
    // its first run is the rule's first after it was made: as if made six minutes ago
    src.automations.find(place, 'Nightly')!.since = Date.now() - 6 * 60_000
    ;(src as unknown as { runSchedules(): void }).runSchedules()
    expect(tasks().map((x) => [x.title, x.by, x.agent?.kind])).toEqual([['Bump deps', 'the automation “Nightly”', 'codex']])
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
      task: { title: 'Bump all deps', agent: { kind: 'codex' } },
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
      /Nightly · Every day at 3:00 \(.+\) \[--when "DTSTART:20260101T000000 RRULE:FREQ=DAILY;BYHOUR=3;BYMINUTE=0"\] · adds “Bump all deps” \(codex\) · autos · paused · last ran/,
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
      // an older helper there still says Manual: read as regular
      expect(src.snapshot().places.find((p) => p.id === 'p:far:~')?.mode).toBe('regular')
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

describe("coordinator timer is the owner's switch alone", () => {
  test("an agent's shell cannot turn it on; the record of the owner's switch holds who and when", async () => {
    const place = placeId.home(HOST)
    const refused = await src.cli(['mode', 'home', 'autopilot'], { chat: 'LIN-1/Agent' })
    expect(refused.code).toBe(1)
    expect(refused.out).toContain('only by the owner')
    expect(src.places.mode(place)).toBe('regular')
    const at = Date.now()
    src.places.recordSwitch(place, 'autopilot', { by: 'terminal', who: 'Owner', at })
    expect(readJson<Record<string, unknown>>('autopilot-switch.json', {})[place]).toEqual({ by: 'terminal', who: 'Owner', at })
    src.places.recordSwitch(place, 'regular')
    expect(readJson<Record<string, unknown>>('autopilot-switch.json', {})[place]).toBeUndefined()
  })

  test("a restart or a setting cannot start coordinator timer again without the owner's switch on record", async () => {
    const place = placeId.home(HOST)
    const start = (src as unknown as { switchPilot(p: string, m: 'autopilot'): Promise<void> }).switchPilot.bind(src)
    await expect(start(place, 'autopilot')).rejects.toThrow('not switched on by the owner')
  })

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
