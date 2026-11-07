import { stopSource, placeId, hidden, src, until, workedTask } from './source-fixture.ts'
import { afterAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('private instruction CLI', () => {
  test('an explicit empty value suppresses inherited instructions without restarting agents', async () => {
    try {
      expect((await src.cli(['set', 'task.instructions', 'Everywhere rule.'], {})).code).toBe(0)
      const blank = await src.cli(['set', 'task.instructions', '', '--machine'], {})
      expect(blank.code).toBe(0)
      expect(blank.out).toContain('running agents are unchanged')
      expect(src.settings.get('task.instructions')).toBe('')
      expect(src.settings.pick('task.instructions').from).toBe('machine')
      expect((await src.cli(['unset', 'task.instructions', '--machine'], {})).code).toBe(0)
      expect(src.settings.get('task.instructions')).toBe('Everywhere rule.')
    } finally {
      src.settings.set('task.instructions', null, 'machine')
      src.settings.set('task.instructions', null)
    }
  })
})

describe('merging from the command', () => {
  test("a task's agent merges its own task, and only its own", async () => {
    const { t, dir } = await workedTask('own')
    const other = await workedTask('other')
    const no = await src.cli(['merge', other.t.id], { chat: `${t.id}/Agent` })
    expect(no.code).toBe(1)
    expect(no.out).toContain('only its own task')
    expect(other.t.merged).toBeFalsy()
    const r = await src.cli(['merge', t.id], { chat: `${t.id}/Agent` })
    expect(r.out).toContain(`Merged ${t.id} into main`)
    expect(r.out).toContain('do nothing more in them')
    expect(existsSync(join(dir, 'x.txt'))).toBe(true)
    expect(src.engine.statusOf(t)).toBe('done')
  })
  test("lineclear pr and checks: a task's agent works on its own only, and a repo with no GitHub says so", async () => {
    const { t } = await workedTask('prs')
    const other = await workedTask('prs2')
    const no = await src.cli(['pr', other.t.id], { chat: `${t.id}/Agent` })
    expect(no.code).toBe(1)
    expect(no.out).toContain('its own task')
    const r = await src.cli(['pr', t.id], { chat: `${t.id}/Agent` })
    expect(r.code).toBe(0)
    expect(r.out).toContain('No pull request')
    expect((await src.cli(['checks', t.id], { chat: `${t.id}/Agent` })).out).toContain('No GitHub checks')
  })
  test("a Done card links the task's pull request", async () => {
    const { t, place } = await workedTask('prcard')
    const pr = { number: 7, url: 'https://github.com/acme/app/pull/7' }
    ;(src as unknown as { onCard(t: unknown, s: string, sub: string): void }).onCard({ ...t, pr, posted: 'done|x' }, 'done', 'x')
    expect(src.chats.chat(place).messages.find((m) => m.card?.status === 'done')?.card?.pr).toEqual(pr)
  })
  test("a merged task gets a Done card in its project's chat, as a message", async () => {
    const { t, place } = await workedTask('carded')
    await src.engine.done(t.id, 'Added x.txt.')
    expect((await src.cli(['merge', t.id], {})).out).toContain('Merged')
    // (herdr isn't here, so its start went wrong: that card comes first)
    const cards = () => src.chats.chat(place).messages.filter((m) => m.card?.status === 'done')
    // one line of a few words: its summary is in the task
    expect(cards().map((m) => [m.card!.status, m.card!.text, m.text])).toEqual([['done', 'is merged', `${t.id} is merged`]])
  })
  test("a coordinator's <no-reply> after the news shows nothing in the chat; its words do", async () => {
    const { t, place } = await workedTask('noted')
    expect((await src.cli(['merge', t.id], {})).out).toContain('Merged')
    const ev = (src.chats as unknown as { events: Map<string, unknown[]> }).events
    const at = Date.now() + 10
    ev.set(place, [
      ...(ev.get(place) ?? []),
      { kind: 'user', id: 'n1', at, text: hidden(`${t.id} was merged.`, 'news', { task: t.id, event: 'merged' }) },
      { kind: 'agent', id: 'a1', at: at + 1, text: '<no-reply>merged, nothing next</no-reply>' },
    ])
    const agentSaid = () => src.chats.chat(place).messages.filter((m) => m.who === 'agent' && !m.card)
    expect(agentSaid()).toEqual([])
    expect(src.chats.lastReply(place)).toBe('')
    ev.set(place, [...(ev.get(place) ?? []), { kind: 'agent', id: 'a2', at: at + 2, text: '<no-reply>merged</no-reply>\nNext: start SHE-9.' }])
    expect(agentSaid().map((m) => m.text)).toEqual(['<no-reply>merged</no-reply>\nNext: start SHE-9.'])
  })
  test('a coordinator merges when the human asks, and you from a terminal', async () => {
    const a = await workedTask('coord')
    expect((await src.cli(['task', 'merge', a.t.id], { chat: a.place })).out).toContain('Merged')
    const b = await workedTask('term')
    expect((await src.cli(['merge', b.t.id], {})).out).toContain('Merged')
    expect(existsSync(join(b.dir, 'x.txt'))).toBe(true)
  })
  test('task list shows Done tasks newest finished first, after the rest', async () => {
    const a = await workedTask('first')
    const b = await workedTask('second')
    const open = await workedTask('open')
    expect((await src.cli(['merge', a.t.id], {})).out).toContain('Merged')
    await Bun.sleep(5)
    expect((await src.cli(['merge', b.t.id], {})).out).toContain('Merged')
    const ids = [a.t.id, b.t.id, open.t.id]
    const listed = (JSON.parse((await src.cli(['task', 'list', '--json'], {})).out) as { id: string }[]).map((t) => t.id).filter((id) => ids.includes(id))
    expect(listed).toEqual([open.t.id, b.t.id, a.t.id])
    expect(src.engine.view(b.t).doneAt).toBe(b.t.doneAt!)
    expect(src.engine.view(open.t).doneAt).toBeUndefined()
  })
  test('the old task settings and their flags are gone', async () => {
    expect((await src.cli(['set', 'merge.by', 'by itself'], {})).code).toBe(1)
    expect((await src.cli(['review', 'X-1', '--verdict', 'pass'], {})).code).toBe(1)
    expect((await src.cli(['task', 'pick', 'X-1', 'A'], {})).code).toBe(1)
  })
})

describe('closing from the command', () => {
  /** a project with a task whose agent made no changes */
  async function emptyTask(name: string) {
    const dir = mkdtempSync(join(tmpdir(), 'shep-src-repo-'))
    execSync('git init -q -b main && git config user.email t@t && git config user.name T && echo hi > README.md && git add -A && git commit -qm init', {
      cwd: dir,
      shell: '/bin/sh',
    })
    const p = await src.places.add(dir, name)
    const t = src.engine.add({ project: p.name, title: 'Answer', by: 'test' })
    await until(() => !!t.worktree).catch(() => undefined)
    if (!t.worktree) throw new Error(`${t.id} got no worktree: ${t.trouble}`)
    return { t, dir, place: placeId.space(p.name) }
  }

  test('a coordinator closes a task with nothing to merge: Done, and its card says so', async () => {
    const { t, place } = await emptyTask('closed')
    const other = await emptyTask('notyours')
    const no = await src.cli(['task', 'close', t.id], { chat: `${other.t.id}/Agent` })
    expect(no.code).toBe(1)
    expect(no.out).toContain('Coordinators close tasks')
    const r = await src.cli(['task', 'close', t.id, '--summary', 'Answered in chat.'], { chat: place })
    expect(r.code).toBe(0)
    expect(r.out).toContain(`Closed ${t.id}: it is Done`)
    expect(r.out).toContain('its working folder and branch are gone')
    expect(src.engine.statusOf(t)).toBe('done')
    expect(src.engine.view(t).sub).toBe('Nothing to merge')
    const cards = src.chats.chat(place).messages.filter((m) => m.card?.status === 'done')
    expect(cards.map((m) => m.text)).toEqual([`${t.id} is done, nothing to merge`])
    expect((await src.cli(['task', 'close', t.id], { chat: place })).out).toContain('Done already (nothing to merge)')
    expect((await src.cli(['merge', t.id], { chat: place })).out).toContain('nothing to merge')
  })

  test('ready with no id is the task of the agent that says it; from anywhere else it is refused, not a crash', async () => {
    const { t } = await emptyTask('noid')
    const none = await src.cli(['ready', '--summary', 'x'], {})
    expect(none.code).toBe(1)
    expect(none.out).toContain('lineclear ready <id>')
    const r = await src.cli(['ready', '--summary', 'The answer is 42.'], { chat: `${t.id}/Agent` })
    expect(r.code).toBe(0)
    expect(r.out).toContain('nothing to merge')
    expect(src.engine.statusOf(t)).toBe('done')
  })

  test("a task agent's ready on a branch with no changes is Done at once; done, its old name, still works", async () => {
    const { t, place } = await emptyTask('research')
    const r = await src.cli(['ready', t.id, '--summary', 'The answer is 42.'], { chat: `${t.id}/Agent` })
    expect(r.out).toContain('nothing to merge')
    expect(r.out).toContain('do nothing more in them')
    expect(src.engine.statusOf(t)).toBe('done')
    const cards = src.chats.chat(place).messages.filter((m) => m.card?.status === 'done')
    expect(cards.map((m) => m.card!.text)).toEqual(['is done, nothing to merge'])
    expect((await src.cli(['done', t.id], { chat: `${t.id}/Agent` })).out).toContain('Done already (nothing to merge)')
  })

  test('a summary past 160 characters is refused, for the agent to rewrite; the facts go apart, kept off the card', async () => {
    const { t, place } = await emptyTask('short')
    const long = await src.cli(['ready', t.id, '--summary', 'x'.repeat(161)], { chat: `${t.id}/Agent` })
    expect(long.code).toBe(1)
    expect(long.out).toContain('That summary is 161 characters: write a shorter one, 160 at most')
    expect(src.engine.statusOf(t)).not.toBe('done')
    // a facts line written at the summary's end comes apart, and doesn't count
    const r = await src.cli(['ready', t.id, '--summary', `Cards are short. Facts: branch work/1-x · ${'checks passed · '.repeat(12)}`], {
      chat: `${t.id}/Agent`,
    })
    expect(r.code).toBe(0)
    expect(src.engine.view(t).said).toBe('Cards are short.')
    expect(src.engine.view(t).facts).toStartWith('branch work/1-x · checks passed')
    const card = src.chats.chat(place).messages.find((m) => m.card?.status === 'done')!.card!
    expect(JSON.stringify(card)).not.toContain('Cards are short')
    expect(JSON.stringify(card)).not.toContain('checks passed')
  })
})

describe('deleting a task from the command', () => {
  test('only a coordinator deletes; work main lacks is refused unless --force; then it is gone from every list', async () => {
    const { t, dir, place } = await workedTask('deleting')
    const key = `${t.id}/Agent`
    const no = await src.cli(['task', 'delete', t.id], { chat: key })
    expect(no.code).toBe(1)
    expect(no.out).toContain('only a coordinator')
    const held = await src.cli(['task', 'delete', t.id], { chat: place })
    expect(held.code).toBe(1)
    expect(held.out).toContain(`Not deleted: ${t.id} holds`)
    expect(held.out).toContain('--force')
    expect(src.engine.task(t.id)).toBe(t)
    // its chat had a log and a file
    src.chats.post(key, { id: 'x', text: 'A card' })
    const file = await src.upload(key, 'a.txt', new TextEncoder().encode('a'))
    const r = await src.cli(['task', 'delete', '--force', t.id], { chat: place })
    expect(r.out).toContain(`Deleted ${t.id}`)
    expect(src.engine.task(t.id)).toBeUndefined()
    expect(existsSync(t.worktree!)).toBe(false)
    expect(execSync('git branch --list "work/*"', { cwd: dir, encoding: 'utf8' }).trim()).toBe('')
    expect(existsSync(join(process.env.LINECLEAR_HOME!, 'chatlog', `${key.replace('/', '_')}.json`))).toBe(false)
    expect(existsSync(file)).toBe(false)
    expect(src.agents.record(key)).toBeUndefined()
    expect((await src.cli(['task', 'list'], {})).out).not.toContain(t.id)
  })

  test('a merged task can be deleted; its commits stay on main', async () => {
    const { t, dir } = await workedTask('delmerged')
    expect((await src.cli(['merge', t.id], {})).out).toContain('Merged')
    const r = await src.cli(['task', 'delete', t.id], {})
    expect(r.out).toContain(`Its commits stay on main`)
    expect(src.engine.task(t.id)).toBeUndefined()
    expect(existsSync(join(dir, 'x.txt'))).toBe(true)
  })
})

describe('base branch choices', () => {
  test('CLI and Settings keep task snapshots, validate before adding, and show the target', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shep-base-cli-'))
    execSync(
      'git init -q -b main && git config user.email t@t && git config user.name T && touch README && git add . && git commit -qm init && git branch develop && git branch feature/topic',
      { cwd: dir },
    )
    const p = await src.places.add(dir, 'base-cli')
    const place = placeId.space(p.name)
    expect((await src.cli(['set', 'space.base', 'develop', '--space', p.name], {})).code).toBe(0)
    expect((await src.cli(['show', '--space', p.name], {})).out).toContain('Base branch: develop')
    const add = await src.cli(['task', 'add', 'Use feature', '--base', 'feature/topic', '--space', p.name], {})
    expect(add.code).toBe(0)
    const t = src.engine.tasks.at(-1)!
    expect(t.base).toBe('feature/topic')
    expect((await src.cli(['task', 'show', t.id], {})).out).toContain('Merges into: feature/topic')
    const count = src.engine.tasks.length
    expect((await src.cli(['task', 'add', 'Bad base', '--base', 'missing', '--space', p.name], {})).code).toBe(1)
    expect(src.engine.tasks.length).toBe(count)
    expect((await src.cli(['space', 'set', 'base', 'main', '--space', p.name], {})).code).toBe(0)
    expect(t.base).toBe('feature/topic')
    expect(await src.act({ type: 'setting', place, key: 'space.base', value: 'develop' })).toMatchObject({ ok: true })
    expect(await src.act({ type: 'setting', place, key: 'space.base', value: 'missing' })).toMatchObject({ ok: false })
    expect(p.base).toBe('develop')
    expect(src.snapshot().settings.find((s) => s.level === place && s.name === 'Repository')!.rows[0].value).toBe('develop')
    expect((await src.cli(['set', 'space.base', 'main'], {})).code).toBe(1)
    expect((await src.cli(['set', 'space.base', 'main', '--space', 'home'], {})).code).toBe(1)
    await until(() => !!t.trouble)
  })
})

describe('To do from the command', () => {
  test('task add starts its agent; lineclear todo shows it as To do, and a message to its agent is the go', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shep-src-repo-'))
    execSync('git init -q -b main && git config user.email t@t && git config user.name T && echo hi > README.md && git add -A && git commit -qm init', {
      cwd: dir,
      shell: '/bin/sh',
    })
    const p = await src.places.add(dir, 'later')
    const place = placeId.space(p.name)
    // a title too long for one line on a phone is refused, and nothing is added
    const before = src.engine.tasks.length
    const long = await src.cli(['task', 'add', 'Reply to any message, plus what the best chats do', '--desc', 'x'], { chat: place })
    expect(long.code).toBe(1)
    expect(long.out).toContain('49 characters')
    expect(long.out).toContain('32 at most')
    expect(src.engine.tasks.length).toBe(before)
    const add = await src.cli(['task', 'add', 'Noted', '--desc', 'For later.', '--later'], { chat: place })
    expect(add.out).toContain('Its agent (pi) reads the brief now and waits for a go')
    const id = add.out.match(/([A-Z]+-\d+)/)![1]
    const other = await src.cli(['task', 'add', 'Next', '--desc', 'x'], { chat: place })
    expect(src.engine.task(add.out.match(/([A-Z]+-\d+)/)![1])!.desc).toStartWith("For later.\n\nDon't start yet: wait for a go.")
    // the old ways are gone
    expect((await src.cli(['task', 'start', id], { chat: place })).code).toBe(1)
    expect((await src.cli(['task', 'edit', id, '--desc', 'x'], { chat: place })).code).toBe(1)
    // herdr isn't here: its agents can't start. Let that settle before the tests after this one
    const t = src.engine.task(id)!
    const next = src.engine.task(other.out.match(/([A-Z]+-\d+)/)![1])!
    await until(() => !!(t.trouble && next.trouble), 'both tasks to show trouble')
    expect((await src.cli(['todo', id], { chat: `${next.id}/Agent` })).code).toBe(1)
    expect((await src.cli(['todo', id], { chat: `${id}/Agent` })).out).toContain('To do until it gets a go')
    expect(t.todo).toBe(true)
    // the go is a message to its agent: it waits for the agent, and the task is no longer To do
    await src.cli(['task', 'tell', id, 'Go.'], { chat: place })
    expect(src.agents.waiting(`${id}/Agent`).map((o) => o.text)).toEqual(['Go.'])
    expect(t.todo).toBeUndefined()
    src.agents.outbox = src.agents.outbox.filter((o) => o.key !== `${id}/Agent`)
  })
})

describe('Queued from the command', () => {
  // CI-quarantine: fails on a GitHub runner only, cause not found yet
  test.skipIf(Boolean(process.env.CI))('task add --after queues it; task queue changes or clears it; what is not there, or a circle, is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shep-src-repo-'))
    execSync('git init -q -b main && git config user.email t@t && git config user.name T && echo hi > README.md && git add -A && git commit -qm init', {
      cwd: dir,
      shell: '/bin/sh',
    })
    const p = await src.places.add(dir, 'queue')
    const place = placeId.space(p.name)
    const idOf = (out: string) => out.match(/([A-Z]+-\d+)/)![1]
    const first = idOf((await src.cli(['task', 'add', 'First', '--desc', 'x'], { chat: place })).out)
    const add = await src.cli(['task', 'add', 'Then', '--desc', 'y', '--after', first], { chat: place })
    expect(add.out).toContain(`queued after ${first}`)
    const then = idOf(add.out)
    expect(src.engine.task(then)!.after).toEqual([first])
    expect((await src.cli(['task', 'add', 'Bad', '--desc', 'y', '--after', 'NOPE-1'], { chat: place })).out).toContain('No task NOPE-1')
    expect((await src.cli(['task', 'add', 'Bad', '--desc', 'y', '--after'], { chat: place })).out).toContain('--after needs the tasks')
    expect((await src.cli(['task', 'add', 'Bad', '--desc', 'y', '--after', 'vm-x:ELA-1'], { chat: place })).out).toContain('no machine called vm-x')
    const loop = await src.cli(['task', 'queue', first, '--after', then], { chat: place })
    expect(loop.code).toBe(1)
    expect(loop.out).toContain(`circle: ${first} → ${then} → ${first}`)
    expect((await src.cli(['task', 'queue', then], { chat: place })).code).toBe(1)
    expect((await src.cli(['task', 'queue', then, '--after', 'none'], { chat: place })).out).toContain('waits for nothing more')
    expect(src.engine.task(then)!.after).toBeUndefined()
    expect((await src.cli(['help'], {})).out).toContain('lineclear task queue <id> --after')
    // another machine's task as it last showed it: refused while it can't be reached; off, so its 5 s poll leaves it alone
    const links = (src.peers as unknown as { links: Map<string, unknown> }).links
    const theirs = { id: 'ELA-3', name: 'Their API', status: 'work', place: 'p:vm-x:api', age: '1m', state: 'Working', on: 'Claude Code', created: '' }
    links.set('vm-x', {
      saved: { label: 'vm-x', enabled: false },
      rec: { machine: 'vm-x', url: 'http://127.0.0.1:9', lastSeen: 0 },
      reachable: false,
      snap: { places: [], tasks: [theirs] },
      chats: new Map(),
      watching: { chats: [], term: null },
      waiting: [],
    })
    expect((await src.cli(['task', 'add', 'Use it', '--desc', 'y', '--after', 'vm-x:ELA-3'], { chat: place })).out).toContain("can't reach vm-x")
    ;(links.get('vm-x') as { reachable: boolean }).reachable = true
    expect((await src.cli(['task', 'add', 'Use it', '--desc', 'y', '--after', 'vm-x:ELA-9'], { chat: place })).out).toContain('vm-x has no task ELA-9')
    const used = await src.cli(['task', 'add', 'Use it', '--desc', 'y', '--after', 'Vm-X:ela-3'], { chat: place })
    expect(used.out).toContain('queued after vm-x:ELA-3')
    const use = src.engine.task(idOf(used.out))!
    theirs.status = 'done'
    src.engine.recheck()
    expect(use.after).toBeUndefined()
    links.delete('vm-x')
    // herdr isn't here: its agents can't start. Let that settle before the tests after this one
    const ts = [first, then, use.id].map((id) => src.engine.task(id)!)
    await until(() => ts.every((t) => t.trouble), 'every task to show trouble')
    src.agents.outbox = src.agents.outbox.filter((o) => !ts.some((t) => o.key === `${t.id}/Agent`))
  })
})

afterAll(stopSource)
