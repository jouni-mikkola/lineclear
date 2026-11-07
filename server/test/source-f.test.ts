import { stopSource, HOST, NAME, placeId, Places, src, workedTask } from './source-fixture.ts'
import { afterAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
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

afterAll(stopSource)
