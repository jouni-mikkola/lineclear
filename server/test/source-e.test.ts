import { stopSource, placeId, src, until, workedTask } from './source-fixture.ts'
import { afterAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
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
      expect(news('ready', home)).toEqual([home])
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
