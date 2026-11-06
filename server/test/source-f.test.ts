import { stopSource, HOST, NAME, placeId, Places, src, workedTask } from './source-fixture.ts'
import { afterAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('removing a space', () => {
  test('the command and the sidebar forget it, its folder stays; not while one of its tasks works; added again, its tasks come back', async () => {
    const { t, dir, place } = await workedTask('forgotten')
    const statusOf = src.engine.statusOf.bind(src.engine)
    src.engine.statusOf = (x) => (x.id === t.id ? 'work' : statusOf(x))
    try {
      const busy = await src.cli(['space', 'remove', 'forgotten'], {})
      expect(busy.code).toBe(1)
      expect(busy.out).toContain(`${t.id} is still working: pause or finish it first.`)
      expect(await src.act({ type: 'space-remove', place })).toEqual({ ok: false, error: `${t.id} is still working: pause or finish it first.` })
    } finally {
      src.engine.statusOf = statusOf
    }
    expect(src.places.byName('forgotten')).toBeDefined()
    expect(await src.act({ type: 'space-remove', place })).toEqual({ ok: true })
    expect(src.places.byName('forgotten')).toBeUndefined()
    expect(existsSync(join(dir, 'README.md'))).toBe(true)
    expect(src.snapshot().places.some((p) => p.id === place)).toBe(false)
    expect(src.snapshot().tasks.some((x) => x.id === t.id)).toBe(false)
    expect(await src.act({ type: 'space-remove', place })).toEqual({ ok: false, error: 'That space is gone already.' })
    expect((await src.cli(['space', 'remove', 'forgotten'], {})).out).toContain('No space called forgotten')
    expect((await src.cli(['space', 'remove'], {})).out).toContain('lineclear space remove <name>')
    // added again (project, from before spaces, still works): its task is back
    await src.cli(['project', 'add', dir, '--name', 'forgotten'], {})
    expect(src.snapshot().tasks.some((x) => x.id === t.id)).toBe(true)
    const r = await src.cli(['space', 'remove', 'forgotten'], {})
    expect(r.code).toBe(0)
    expect(r.out.trim()).toBe(
      `Removed forgotten from Lineclear; ${dir} and its code stay on disk. lineclear space add ${dir} --name forgotten brings it back with its open tasks and chat.`,
    )
  })
  test('the home space can be renamed, never removed: by the sidebar or the command', async () => {
    const home = placeId.home()
    const says = `home is ${NAME}'s home space: it can be renamed, not removed.`
    expect(await src.act({ type: 'space-remove', place: home })).toEqual({ ok: false, error: says })
    const r = await src.cli(['space', 'remove', 'home'], {})
    expect(r.code).toBe(1)
    expect(r.out).toContain(says)
    expect(src.snapshot().places.find((p) => p.id === home)).toMatchObject({ home: true, name: 'home' })
  })
  test('lineclear space add refuses a name another space has, or one that breaks the rules', async () => {
    const repo = () => {
      const dir = mkdtempSync(join(tmpdir(), 'shep-src-taken-'))
      execSync('git init -q -b main', { cwd: dir })
      return dir
    }
    await src.places.add(repo(), 'taken')
    const before = src.places.spaces.length
    for (const name of ['taken', 'home']) {
      const r = await src.cli(['space', 'add', repo(), '--name', name], {})
      expect(r.code).toBe(1)
      expect(r.out).toContain('Another space on this machine has that name.')
    }
    const bad = await src.cli(['space', 'add', repo(), '--name', 'My App'], {})
    expect(bad.code).toBe(1)
    expect(bad.out).toContain('Lowercase only.')
    expect(src.places.spaces.length).toBe(before)
  })
})

describe('the order of places', () => {
  test('A to Z until dragged; the order is kept on disk, and a new space slots in A to Z', async () => {
    const add = async (name: string) => {
      const dir = mkdtempSync(join(tmpdir(), 'shep-src-order-'))
      execSync('git init -q -b main', { cwd: dir })
      await src.places.add(dir, name)
    }
    await add('order-zed')
    await add('order-alpha')
    const mine = () =>
      src
        .snapshot()
        .places.filter((p) => p.name.startsWith('order-'))
        .map((p) => p.name)
    expect(mine()).toEqual(['order-alpha', 'order-zed'])
    const machine = placeId.machine()
    const ids = src
      .snapshot()
      .places.filter((p) => !p.home && p.machine === HOST)
      .map((p) => p.id)
    const dragged = [placeId.space('order-zed'), ...ids.filter((id) => id !== placeId.space('order-zed'))]
    expect(await src.act({ type: 'order', under: machine, ids: dragged })).toEqual({ ok: true })
    expect(mine()).toEqual(['order-zed', 'order-alpha'])
    // the machine's home space is always first, then its spaces in their order
    const places = src.snapshot().places
    expect(places.find((p) => p.machine === HOST)?.id).toBe(placeId.home())
    expect(places.findIndex((p) => p.name === 'order-zed')).toBe(places.findIndex((p) => p.id === placeId.home()) + 1)
    expect(new Places().order[machine]).toEqual(dragged)
    await add('order-beta')
    expect(mine()).toEqual(['order-zed', 'order-alpha', 'order-beta'])
    expect(await src.act({ type: 'order', under: machine, ids: 'nope' } as never)).toEqual({ ok: false, error: 'No order to keep.' })
  })
})

describe('renaming places', () => {
  test("only the name that shows changes, kept on disk; its id, folder and task key stay; a space's name follows the rules", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shep-src-rename-'))
    execSync('git init -q -b main', { cwd: dir })
    const p = await src.places.add(dir, 'rename-me')
    const id = placeId.space('rename-me')
    const home = placeId.home()
    const machine = placeId.machine()
    const named = (x: string) => src.snapshot().places.find((y) => y.id === x)?.name
    // a space's name, as Slack's channels: lowercase, no spaces
    expect(await src.act({ type: 'rename', id, name: '  My   App ' })).toEqual({ ok: false, error: 'Lowercase only.' })
    expect(await src.act({ type: 'rename', id, name: 'my app' })).toEqual({ ok: false, error: 'No spaces: use - or _.' })
    expect(await src.act({ type: 'rename', id, name: 'my-app' })).toEqual({ ok: true })
    expect(named(id)).toBe('my-app')
    expect(src.chatName(id)).toBe('my-app')
    expect([p.name, p.path, src.places.space(id)?.key]).toEqual(['rename-me', dir, p.key])
    expect(new Places().names[id]).toBe('my-app')
    // the command too
    expect((await src.cli(['space', 'rename', 'my-app', 'Bad Name'], {})).code).toBe(1)
    expect((await src.cli(['space', 'rename', 'my-app', 'good_name'], {})).out).toContain('my-app is called good_name now.')
    expect(named(id)).toBe('good_name')
    // a machine's name is free text
    expect(await src.act({ type: 'rename', id: machine, name: 'Home box' })).toEqual({ ok: true })
    expect(src.snapshot().machines.find((m) => m.id === machine)).toMatchObject({ name: 'Home box', machine: HOST })
    // and its emoji, as a Slack section's: one emoji, kept on disk; '' takes it away, none leaves it; a space takes none
    expect(await src.act({ type: 'rename', id: machine, name: 'Home box', emoji: '🏠' })).toEqual({ ok: true })
    expect(src.snapshot().machines.find((m) => m.id === machine)?.emoji).toBe('🏠')
    expect(new Places().emojis[machine]).toBe('🏠')
    expect(await src.act({ type: 'rename', id: machine, name: 'Home box' })).toEqual({ ok: true })
    expect(src.snapshot().machines.find((m) => m.id === machine)?.emoji).toBe('🏠')
    for (const bad of ['hi', '🏠🚀', 'x🏠'])
      expect(await src.act({ type: 'rename', id: machine, name: 'Home box', emoji: bad })).toEqual({
        ok: false,
        error: 'Only a machine takes an emoji, one at a time.',
      })
    expect(await src.act({ type: 'rename', id, name: 'my-app', emoji: '🚀' })).toEqual({ ok: false, error: 'Only a machine takes an emoji, one at a time.' })
    expect(await src.act({ type: 'rename', id: machine, name: 'Home box', emoji: '👍🏽' })).toEqual({ ok: true })
    expect(await src.act({ type: 'rename', id: machine, name: 'Home box', emoji: '' })).toEqual({ ok: true })
    expect(src.snapshot().machines.find((m) => m.id === machine)?.emoji).toBeUndefined()
    expect(new Places().emojis).toEqual({})
    // the home space can be renamed; another space on the machine can't take its name
    expect(await src.act({ type: 'rename', id, name: 'home' })).toEqual({ ok: false, error: 'Another space on this machine has that name.' })
    expect(await src.act({ type: 'rename', id: home, name: 'base' })).toEqual({ ok: true })
    expect(named(home)).toBe('base')
    expect(await src.act({ type: 'rename', id: 'all', name: 'Everything' })).toEqual({ ok: false, error: 'Nothing to rename.' })
    expect(await src.act({ type: 'rename', id, name: 'x'.repeat(81) })).toEqual({ ok: false, error: 'A name fits 80 characters.' })
    // empty: its own name again
    expect(await src.act({ type: 'rename', id, name: '' })).toEqual({ ok: true })
    expect(await src.act({ type: 'rename', id: home, name: '' })).toEqual({ ok: true })
    expect(await src.act({ type: 'rename', id: machine, name: '' })).toEqual({ ok: true })
    expect(named(id)).toBe('rename-me')
    expect(named(home)).toBe('home')
    expect(new Places().names).toEqual({})
  })
})

describe('artifacts from the command', () => {
  const files = mkdtempSync(join(tmpdir(), 'shep-src-art-'))
  writeFileSync(join(files, 'board.html'), '<h1>Board</h1>')
  writeFileSync(join(files, 'data.json'), '{"n":2}')
  const ok = async () => ({ errors: [], warnings: [], skipped: 'no browser in the test' })

  test('made in a task chat: a card there, kept in its project; an update is a new version, data alone keeps the page', async () => {
    src.checker = ok
    const { t, place } = await workedTask('arts')
    const chat = `${t.id}/Agent`
    const r = await src.cli(['artifact', 'new', 'board.html', '--title', 'Weekly board'], { chat, cwd: files })
    expect(r.code).toBe(0)
    expect(r.out).toContain('No pictures: no browser in the test')
    const id = r.out.match(/artifact (\w+) “Weekly board” v1/)![1]
    expect(src.snapshot().artifacts.find((a) => a.id === id)).toMatchObject({
      title: 'Weekly board',
      place,
      v: 1,
      by: `${t.id} agent`,
      keeper: `${t.id} agent`,
    })
    expect(src.chats.chat(chat).messages.find((m) => m.artifact?.id === id)?.artifact).toEqual({ id, v: 1 })
    // its coordinator brings new numbers: v2, the same page, a card in the coordinator's chat
    const u = await src.cli(['artifact', 'update', id, '--data', 'data.json', '--note', 'fresh'], { chat: place, cwd: files })
    expect(u.out).toContain(`${id} “Weekly board” is v2 (same page, new data)`)
    expect(await src.artifact(id)).toEqual({ html: '<h1>Board</h1>', data: { n: 2 }, sent: undefined })
    expect(src.chats.chat(place).messages.find((m) => m.artifact?.id === id)?.artifact).toEqual({ id, v: 2 })
    expect((await src.cli(['artifact', 'show', id], {})).out).toContain(`v2  now  arts  (data only)  fresh`)
    expect((await src.cli(['artifact', 'list'], {})).out).toContain(`${id}  v2  Weekly board  · arts`)
  })

  test('its card is a message of its own after the words it came with; a reaction or reply to it names it, and reads back on it', async () => {
    src.checker = ok
    const { t } = await workedTask('artre')
    const chat = `${t.id}/Agent`
    const id = (await src.cli(['artifact', 'new', 'board.html', '--title', 'Weekly board'], { chat, cwd: files })).out.match(/artifact (\w+)/)![1]
    const ev = (src.chats as unknown as { events: Map<string, unknown[]> }).events
    const log = (e: object) => ev.set(chat, [...(ev.get(chat) ?? []), { at: Date.now(), ...e }])
    // the agent's words of that turn come after it, and the card shows under them
    log({ kind: 'agent', id: 'w1', text: 'Here is the board.' })
    const msgs = () => src.chats.chat(chat).messages
    const at = msgs().findIndex((m) => m.id === 'w1')
    expect(msgs()[at]).not.toHaveProperty('artifact')
    const card = msgs()[at + 1]
    expect(card).toMatchObject({ who: 'agent', artifact: { id, v: 1 } })
    const sent: string[] = []
    const send = src.agents.send
    src.agents.send = (async (_k: string, text: string) => (sent.push(text), { waiting: false })) as typeof send
    try {
      expect(await src.act({ type: 'react', chat, message: card.id, emoji: '👍' })).toEqual({})
      await src.act({ type: 'send', chat, text: 'Bars in blue', reply: card.id })
    } finally {
      src.agents.send = send
    }
    expect(sent).toEqual([
      `<reaction from="${src.user}" emoji="👍" title="Weekly board" artifact="${id}" version="1"/>`,
      `<reply from="${src.user}" to="Weekly board · v1" artifact="${id}">Bars in blue</reply>`,
    ])
    log({ kind: 'user', id: 'u1', text: sent[0] })
    log({ kind: 'user', id: 'u2', text: sent[1] })
    expect(msgs().find((m) => m.id === card.id)?.reactions).toEqual([{ emoji: '👍', by: 'me' }])
    expect(msgs().find((m) => m.id === 'w1')?.reactions).toBeUndefined()
    expect(msgs().find((m) => m.id === 'u2')).toMatchObject({
      text: 'Bars in blue',
      reply: { id: card.id, who: 'agent', text: 'Weekly board · v1', artifact: true },
    })
    // taken back
    log({ kind: 'user', id: 'u3', text: sent[0].replace('<reaction ', '<reaction-removed ') })
    expect(msgs().find((m) => m.id === card.id)?.reactions ?? []).toEqual([])
  })

  test('a page whose scripts break or that reaches for the network is refused, with what broke', async () => {
    src.checker = ok
    const id = (await src.cli(['artifact', 'new', 'board.html', '--title', 'Fine'], { cwd: files })).out.match(/artifact (\w+)/)![1]
    src.checker = async () => ({
      errors: ['script error: x is not defined', 'blocked: https://cdn.example/x.js (artifacts load nothing: put it inline)'],
      warnings: [],
      shots: { light: '/p.png', dark: '/p-dark.png' },
    })
    const bad = await src.cli(['artifact', 'update', id, 'board.html'], { cwd: files })
    expect(bad.code).toBe(1)
    expect(bad.out).toContain('Not updated')
    expect(bad.out).toContain('- script error: x is not defined')
    expect(bad.out).toContain('/p.png')
    expect(src.artifacts.get(id)!.versions.length).toBe(1)
    src.checker = ok
  })

  test('its keeper: the agent that made it while its task is open, the coordinator once that task is merged', async () => {
    src.checker = ok
    const { t } = await workedTask('kept')
    const id = (await src.cli(['artifact', 'new', 'board.html', '--title', 'Kept'], { chat: `${t.id}/Agent`, cwd: files })).out.match(/artifact (\w+)/)![1]
    expect(src.snapshot().artifacts.find((a) => a.id === id)!.keeper).toBe(`${t.id} agent`)
    await src.cli(['merge', t.id], {})
    expect(src.snapshot().artifacts.find((a) => a.id === id)!.keeper).toBe('kept')
  })
})

describe("another machine's artifacts", () => {
  test('listed, shown, pictured and acted on through the main machine, by their place', async () => {
    const got: { path: string; body?: unknown }[] = []
    const art = { id: 'farx', title: 'Far board', place: 'p:far2:proj', at: 1, v: 2, when: '1m', by: 'proj', keeper: 'proj', versions: [] }
    const far = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        const u = new URL(req.url)
        got.push({ path: u.pathname + u.search, body: req.method === 'POST' ? await req.json() : undefined })
        if (u.pathname === '/api/snapshot')
          return Response.json({
            name: 'S',
            host: 'far2',
            places: [{ id: 'p:far2:~', name: 'home', machine: 'far2', home: true, level: 1, status: 'idle', mode: 'manual', chat: 'p:far2:~' }],
            machines: [{ id: 'm:far2', machine: 'far2', name: 'far2', status: 'idle' }],
            tasks: [],
            automations: {},
            artifacts: [art],
            asks: {},
            settings: [],
            user: 'u',
          })
        if (u.pathname === '/api/artifacts/farx/raw') return Response.json({ html: `<p>far v${u.searchParams.get('v')}</p>`, data: { n: 1 } })
        if (u.pathname === '/api/artifacts/farx/thumb') return new Response('png', { headers: { 'content-type': 'image/png' } })
        if (u.pathname === '/api/action') return Response.json({ to: 'proj' })
        return new Response('no', { status: 404 })
      },
    })
    try {
      src.peers!.adopt('far2', `http://127.0.0.1:${far.port}`)
      for (let i = 0; i < 50 && !src.peers!.list().find((l) => l.rec.machine === 'far2')?.snap; i++) await new Promise((r) => setTimeout(r, 20))
      expect(src.snapshot().artifacts.find((a) => a.id === 'farx')).toMatchObject({ title: 'Far board', place: 'p:far2:proj' })
      expect(await src.artifact('farx', 2)).toEqual({ html: '<p>far v2</p>', data: { n: 1 } })
      expect(await (await src.artifactThumb('farx', true))!.text()).toBe('png')
      expect(got.some((g) => g.path === '/api/artifacts/farx/thumb?dark=1')).toBe(true)
      const a = { type: 'artifact-send' as const, place: 'p:far2:proj', artifact: 'farx', v: 2, text: 'Colour: Grey' }
      expect(await src.act(a)).toEqual({ to: 'proj' })
      expect(got.find((g) => g.path === '/api/action')?.body).toEqual(a)
      // one this machine doesn't know at all is nowhere
      expect(await src.artifact('nope')).toBeUndefined()
    } finally {
      far.stop(true)
    }
  })
})

describe("a task row's menu, and pin from the command", () => {
  test('pin and unpin: coordinators only, said plainly, shown in task list', async () => {
    const { t } = await workedTask('pins')
    expect((await src.cli(['task', 'pin', t.id], { chat: `${t.id}/Agent` })).code).toBe(1)
    expect((await src.cli(['task', 'pin', t.id], {})).out).toContain(`Pinned ${t.id}`)
    expect((await src.cli(['task', 'list'], {})).out).toContain('(pinned)')
    expect(JSON.parse((await src.cli(['task', 'list', '--json'], {})).out).find((x: { id: string }) => x.id === t.id).pinned).toBeNumber()
    await src.cli(['task', 'unpin', t.id], {})
    expect((await src.cli(['task', 'unpin', t.id], {})).out).toContain(`${t.id} isn't pinned.`)
    expect(await src.act({ type: 'pin', chat: `${t.id}/Agent`, on: true })).toMatchObject({ ok: true })
    expect(t.pinned).toBeNumber()
  })

  test('task close --discard closes a branch main lacks commits of, and says the branch is kept', async () => {
    const { t } = await workedTask('discard')
    expect((await src.cli(['task', 'close', t.id], { chat: placeId.space(t.project) })).code).toBe(1)
    const r = await src.cli(['task', 'close', t.id, '--discard'], { chat: placeId.space(t.project) })
    expect(r.code).toBe(0)
    expect(r.out).toContain(`kept branch ${t.branch}`)
    expect(t.closed).toBeTruthy()
  })

  test('Mark done and Delete say what work stays unmerged, in words without paths, until forced', async () => {
    const { t } = await workedTask('rowmenu')
    expect(await src.act({ type: 'close', chat: `${t.id}/Agent` })).toEqual({ ok: false, held: [`work on ${t.branch} that main lacks`] })
    expect(await src.act({ type: 'delete', chat: `${t.id}/Agent` })).toMatchObject({ ok: false, held: [`work on ${t.branch} that main lacks`] })
    expect(src.engine.task(t.id)).toBe(t)
    expect(await src.act({ type: 'close', chat: `${t.id}/Agent`, force: true })).toMatchObject({ ok: true })
    expect(t.closed).toBeTruthy()
    // closed already: said, not swallowed
    expect(await src.act({ type: 'close', chat: `${t.id}/Agent` })).toMatchObject({
      ok: false,
      error: expect.stringContaining('Done already (nothing to merge)'),
    })
    expect(await src.act({ type: 'delete', chat: `${t.id}/Agent`, force: true })).toMatchObject({ ok: true })
    expect(src.engine.task(t.id)).toBeUndefined()
  })
})

describe('coordinator timer from the command', () => {
  test('one Heartbeat with schedule, agent and shared access/limits; old budget forms stay absent', async () => {
    const { place } = await workedTask('piloting')
    src.places.setMode(place, 'autopilot')
    try {
      // the coordinator, on its own: Lineclear adds what it asks; the machine's max tasks at once bounds the rest
      expect((await src.cli(['task', 'add', 'Fix the typo', '--desc', 'Fix it.'], { chat: place })).out).toContain('Added')
      expect((await src.cli(['task', 'add', 'Fix the link', '--desc', 'Fix it.'], { chat: place })).out).toContain('Added')
      for (const s of src.snapshot().settings.filter((x) => x.name === 'Coordinator timer')) {
        const keys = s.rows.map((r) => r.key)
        expect(keys).toContain('heartbeat.when')
        expect(keys).toContain('heartbeat.on')
        expect(keys).toContain('autopilot.agent')
        expect(keys).toContain('autopilot.parallel')
        expect(keys).toContain('autopilot.traffic')
        expect(keys).toContain('autopilot.tokens')
        expect(s.rows.filter((r) => r.doc)).toHaveLength(s.level?.startsWith('p:') ? 1 : 0)
        expect(s.rows.some((r) => r.label === 'Checklist')).toBe(false)
      }
      const show = (await src.cli(['show'], {})).out
      expect(show).toContain('heartbeat.when')
      expect(show).toContain('heartbeat.on')
      expect(show).toContain('time.zone')
      expect(show).not.toMatch(/tasksPerDay|wake\.|used today|budget/)
    } finally {
      src.places.setMode(place, 'regular')
    }
  })
})

afterAll(stopSource)
