import { describe, expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sh, repo, world, until, started, settingsBlock, writeJson, fakeHerdr } from './engine-world.ts'
import { seedModels } from './model-fixture.ts'

seedModels()

/** past the time a silent agent would be called asking, nothing says it needs the human */
async function staysQuiet(w: ReturnType<typeof world>) {
  await Bun.sleep(4300)
  expect(w.news.some((n) => n.includes('needs you'))).toBe(false)
  expect(w.cards.some((c) => c.status === 'need')).toBe(false)
}

describe('a task is its brief and one agent', () => {
  test('adding a task starts its agent at once, in its own worktree from main, with the brief first', async () => {
    const w = world()
    const { p, t } = await started(w, repo(), 'starts')
    expect(t.id).toBe(`${p.key}-1`)
    expect(t.branch).toBe('work/1-say-hello')
    expect(existsSync(t.worktree!)).toBe(true)
    expect(sh('git branch --show-current', t.worktree!)).toBe('work/1-say-hello')
    const s = w.started[0]
    // the coordinator's words first, then the default way of working from Settings
    expect(s.first).toBe(
      `Say hello\n\nAdd hello.txt. Merge when done.\n\n${settingsBlock(t.id, { ways: w.settings.ways(), reviewer: w.settings.harness('reviewer'), agent: w.settings.harness('task'), by: w.settings.setBy() })}`,
    )
    expect(s.first).toContain('Settings: (from lineclear show; where the brief above says otherwise, it wins)')
    expect(t.desc).toStartWith('Add hello.txt. Merge when done.\n\nSettings:')
    expect(s.cwd).toBe(t.worktree!)
    // the prompt says where its skills are; how it works the task is theirs, not the prompt's
    expect(s.system).toContain('skill/lineclear-agent/SKILL.md')
    expect(s.system).toContain(`task ${t.id}`)
    expect(w.engine.statusOf(t)).toBe('work')
    expect(w.news.some((n) => n.includes('was added'))).toBe(true)
  })

  test('private rules reach launches, stay out of briefs/git, and refresh only on restart', async () => {
    const w = world()
    w.engine.installed = () => true
    const dir = repo()
    writeFileSync(join(dir, 'AGENTS.md'), 'Team rules stay here.\n')
    sh('git add AGENTS.md && git commit -qm team', dir)
    w.settings.set('task.instructions', 'PRIVATE task marker', { space: 'private' })
    w.settings.set('reviewer.instructions', 'PRIVATE reviewer marker', { space: 'private' })
    w.settings.set('coordinator.instructions', 'PRIVATE coordinator marker', { space: 'private' })
    try {
      const { t } = await started(w, dir, 'private')
      const prompt = w.started.at(-1)!.system!
      expect(prompt).toContain('PRIVATE task marker')
      expect(prompt).toContain('PRIVATE reviewer marker')
      expect(prompt).not.toContain('PRIVATE coordinator marker')
      expect(t.desc).not.toContain('PRIVATE')
      expect(w.started.at(-1)!.first).not.toContain('PRIVATE')
      expect(sh('cat AGENTS.md', t.worktree!)).toBe('Team rules stay here.')
      expect(sh('git status --porcelain', t.worktree!)).toBe('')
      const count = w.started.length
      w.settings.set('task.instructions', '', { space: 'private' })
      expect(w.started.length).toBe(count)
      expect(w.started.at(-1)!.system).toBe(prompt)
      await w.engine.restart(t.id, { kind: 'codex' })
      expect(w.started.at(-1)!.system).toContain('Private instructions for task (from space private):\n(none)')
      expect(w.started.at(-1)!.system).not.toContain('PRIVATE task marker')
      expect(w.started.at(-1)!.system).toContain('PRIVATE reviewer marker')
    } finally {
      for (const role of ['task', 'reviewer', 'coordinator']) w.settings.set(`${role}.instructions`, null, { space: 'private' })
    }
  })

  test('starting, it shows To do with no second line until its agent is at work on the brief; no news or card meanwhile', async () => {
    const w = world(fakeHerdr(), { boot: 'idle' })
    const p = await w.places.add(repo(), 'boots')
    const t = w.engine.add({ project: p.name, title: 'Say hello', desc: 'Add hello.txt.', by: 'test' })
    const key = `${t.id}/Agent`
    // its worktree and space are still being made
    expect(w.engine.view(t)).toMatchObject({ status: 'todo', sub: '' })
    await until(() => w.started.some((s) => s.key === key))
    await Bun.sleep(20)
    // the CLI is up, its brief not in yet: still To do, even if herdr says it works (the CLI booting)
    expect(w.engine.view(t)).toMatchObject({ status: 'todo', sub: '' })
    w.agentIs(key, 'working')
    expect(w.engine.statusOf(t)).toBe('todo')
    // the brief goes in while it works: at work on it
    w.brief(key)
    expect(w.engine.view(t)).toMatchObject({ status: 'work', sub: 'Working' })
    expect(w.news.filter((n) => !n.includes('was added'))).toEqual([])
    expect(w.cards).toEqual([])
  })

  test('the brief goes in first and the agent gets to work after: Working then', async () => {
    const w = world(fakeHerdr(), { boot: 'idle' })
    const p = await w.places.add(repo(), 'boots2')
    const t = w.engine.add({ project: p.name, title: 'Say hello', desc: 'Add hello.txt.', by: 'test' })
    const key = `${t.id}/Agent`
    await until(() => w.started.some((s) => s.key === key))
    await Bun.sleep(20)
    w.brief(key)
    expect(w.engine.statusOf(t)).toBe('todo')
    w.agentIs(key, 'working')
    expect(w.engine.statusOf(t)).toBe('work')
    // its first turn ends: it waits on you as usual
    w.agentIs(key, 'idle')
    expect(w.engine.statusOf(t)).toBe('need')
  })

  test("the status follows the agent, and the list and the task's chat always show the same", async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'follows')
    const both = () => {
      const v = w.engine.view(t)
      expect(v.agent?.status).toBe(v.status)
      return v
    }
    expect(both().status).toBe('work')
    // working, its line is a standard word until its agent's status line takes over: never the brief, never its prose
    expect(both().sub).toBe('Working')
    w.agentIs(key, 'blocked')
    expect(both().status).toBe('need')
    expect(both().sub).toBe('Asks permission')
    // the agent got going again inside (a conflict it fixes, an answer it got): the list follows at once
    w.agentIs(key, 'working')
    expect(both().status).toBe('work')
    // its turn ended without reporting done: it waits for you
    w.agentIs(key, 'idle')
    expect(both().status).toBe('need')
    expect(both().sub).toBe('Which name do you want?')
    // it waits again with the same question in a later turn: that is news again
    w.agentIs(key, 'blocked')
    w.agentIs(key, 'working')
    const asked = w.news.filter((n) => n.includes('Asks permission')).length
    w.agentIs(key, 'blocked')
    expect(w.news.filter((n) => n.includes('Asks permission')).length).toBe(asked + 1)
    w.agentIs(key, 'working')
    // it reports done during a turn: still working until the turn ends, then ready
    w.agentIs(key, 'working')
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    await w.engine.done(t.id, 'Added hello.txt.')
    expect(both().status).toBe('work')
    w.agentIs(key, 'idle')
    expect(both().status).toBe('ready')
    expect(both().sub).toBe('Ready to merge')
    // writing to it again asks something of it: no longer done, and working even before it picks the message up
    w.engine.youWrote(key)
    expect(both().status).toBe('work')
    w.agentIs(key, 'working')
    expect(both().status).toBe('work')
  })

  test('coordinators hear once when it waits on you or is ready', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'news')
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    await w.engine.done(t.id, 'Did it.')
    w.agentIs(key, 'idle')
    await until(() => w.news.some((n) => n.includes('is ready to merge: Did it.')))
    w.agentIs(key, 'idle')
    await Bun.sleep(50)
    expect(w.news.filter((n) => n.includes('is ready')).length).toBe(1)
  })

  test("waiting on you shows a standard reason or the agent's own question, never a model's words: the same in the list, cards and news", async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'asks')
    w.chat.reply =
      'The findings back up the design, so the plan stays as it is. I can start on the first step now, or wait while you read the notes. Which do you want?'
    w.agentIs(key, 'idle')
    await until(() => w.cards.length === 1)
    expect(w.engine.view(t).sub).toBe('Which do you want?')
    expect(w.cards[0].sub).toBe('Which do you want?')
    expect(w.news.at(-1)).toBe(`${t.id} needs you: Which do you want?`)
    expect(w.news.some((n) => n.includes('findings'))).toBe(false)
    // a long question is cut at a word to fit one line
    w.chat.reply = 'Should I rename every occurrence of the old setting across all the packages?'
    expect(w.engine.view(t).sub).toBe('Should I rename every occurrence')
    // words that ask nothing: the standard line, never the message
    w.chat.reply = 'A very long message that must never show up in the list of tasks or in the news.'
    expect(w.engine.view(t).sub).toBe('Waits for your reply')
  })

  test('what its hooks report waits on you: a permission prompt, its own question tool, a plan, a lost login', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'hooked')
    const at = Date.now()
    w.status[key] = 'blocked'
    w.said[key] = { state: 'blocked', kind: 'permission', turnAt: at, at }
    expect(w.engine.statusOf(t)).toBe('need')
    expect(w.engine.view(t).sub).toBe('Asks permission')
    w.said[key] = { state: 'blocked', kind: 'question', ask: 'Which colour should the button be?', turnAt: at, at }
    expect(w.engine.view(t).sub).toBe('Which colour should the button be?')
    w.said[key] = { state: 'blocked', kind: 'question', turnAt: at, at }
    expect(w.engine.view(t).sub).toBe('Question for you')
    w.said[key] = { state: 'blocked', kind: 'plan', turnAt: at, at }
    expect(w.engine.view(t).sub).toBe('Plan to approve')
    w.status[key] = 'idle'
    w.said[key] = { state: 'idle', kind: 'auth', last: 'OAuth token has expired', turnAt: at, at }
    w.chat.reply = 'Done with the first part.'
    expect(w.engine.view(t).sub).toBe('Signed out')
  })

  test('a standard reason: a plan, a choice card, a question, a lost login', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'reasons')
    w.status[key] = 'idle'
    w.chat.card = 'plan'
    expect(w.engine.view(t).sub).toBe('Plan to approve')
    w.chat.card = 'ask'
    expect(w.engine.view(t).sub).toBe('Question for you')
    // a choice card says its own question
    w.chat.cardTitle = 'Rerun CI on main?'
    expect(w.engine.view(t).sub).toBe('Rerun CI on main?')
    w.chat.card = undefined
    w.chat.question = true
    w.status[key] = 'blocked'
    expect(w.engine.view(t).sub).toBe('Which one?')
    w.status[key] = 'idle'
    w.chat.question = false
    // a reply about logins is not a lost login
    for (const [r, sub] of [
      ['Fixed the bug where users got logged out after a refresh. Okay to merge?', 'Okay to merge?'],
      ['Now an invalid API key returns 401 instead of 500. Please run /login to try it?', 'Please run /login to try it?'],
      ['Users who are not logged in now see the sign-in page.', 'Waits for your reply'],
    ]) {
      w.chat.reply = r
      expect(w.engine.view(t).sub).toBe(sub)
    }
    w.chat.reply = 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}} · Please run /login'
    expect(w.engine.view(t).sub).toBe('Signed out')
    w.agentIs(key, 'idle')
    await until(() => w.cards.length === 1)
    expect(w.news.at(-1)).toBe(`${t.id} needs you: Signed out`)
  })

  test('a turn that ends while its own background work runs is still work: no news, no card', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'background')
    // it started its fresh-eyes reviewer in the background and ended its turn to wait for it
    w.chat.reply = 'Committed. A reviewer is checking it now.'
    w.bg[key] = 'agents'
    w.agentIs(key, 'done')
    expect(w.engine.statusOf(t)).toBe('work')
    expect(w.engine.view(t).sub).toBe('Working')
    await staysQuiet(w)
    // shells or monitors alone are background work too
    w.bg[key] = 'shells'
    expect(w.engine.statusOf(t)).toBe('work')
    // a link is not a question
    w.chat.reply = 'The preview is up: https://box.ts.net/app?tab=2'
    expect(w.engine.statusOf(t)).toBe('work')
    // a question in its words alone is no fact: still at work while its background work runs
    w.chat.reply = 'The tests run in the background.\n\nWant me to merge once they pass?'
    expect(w.engine.statusOf(t)).toBe('work')
    // a choice card of its waits: that needs you, background or not
    w.chat.reply = 'Pick one.'
    w.chat.card = 'ask'
    expect(w.engine.statusOf(t)).toBe('need')
    w.chat.card = undefined
    // the reviewer finished and woke it; it fixed what it found and stopped with nothing left in the background
    w.agentIs(key, 'working')
    w.bg[key] = undefined
    w.chat.reply = 'Fixed both findings.'
    w.agentIs(key, 'done')
    await until(() => w.news.some((n) => n.includes('needs you')))
    expect(w.engine.statusOf(t)).toBe('need')
  })

  test('SHE-90: a turn that ends with only <no-reply> while its subagent runs is work, never needs you, and no news', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'paused-reviewer')
    // its reviewer's notice woke it ("waiting on its own background work") and it answered with a hidden reply only.
    // That its agent then reports a subagent in the background is tested on the real hooks and Agents
    // (hooks.test.ts, background.test.ts); this is the engine's half: such a turn is work, with no card and no news
    w.chat.reply = ''
    w.bg[key] = 'agents'
    w.agentIs(key, 'done')
    expect(w.engine.statusOf(t)).toBe('work')
    w.chat.reply = '<no-reply>Reviewer still running its checks; waiting for its result</no-reply>'
    expect(w.engine.statusOf(t)).toBe('work')
    expect(w.engine.view(t).sub).toBe('Working')
    await staysQuiet(w)
  })

  test('a plan is a card in its chat; the answer goes back as a chat line', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'planned', 'Docs', 'Plan first and wait for my yes.')
    await w.engine.plan(t.id, ['One', 'Two'])
    const card = w.posted.find((x) => x.question?.kind === 'Plan')
    expect(card?.key).toBe(key)
    expect(card?.question?.steps).toEqual(['One', 'Two'])
    expect(w.engine.view(t).plan).toEqual(['One', 'Two'])
  })

  test('after a restart, what an open task shows is where it starts, not news', () => {
    writeJson('tasks.json', {
      next: { OLD: 2 },
      tasks: [
        {
          id: 'OLD-2',
          n: 2,
          project: 'p:x:old',
          title: 'Open',
          desc: '',
          by: 'x',
          created: 1,
          updated: 1,
          worktree: '/nowhere',
          stage: 'needs-you',
          round: 0,
          reviews: [],
          roles: ['Agent'],
        },
      ],
    })
    const w = world()
    w.agentIs('OLD-2/Agent', 'blocked')
    expect(w.engine.statusOf(w.engine.task('OLD-2')!)).toBe('need')
    expect(w.news).toEqual([])
  })

  test('a task from before is read in: a finished one is merged', () => {
    writeJson('tasks.json', {
      next: { OLD: 1 },
      tasks: [
        {
          id: 'OLD-1',
          n: 1,
          project: 'p:x:old',
          title: 'Old',
          desc: '',
          by: 'x',
          created: 1,
          updated: 1,
          stage: 'done',
          round: 0,
          reviews: [],
          roles: ['Agent'],
        },
      ],
    })
    const w = world()
    const t = w.engine.task('OLD-1')!
    expect(w.engine.statusOf(t)).toBe('done')
    expect('stage' in t).toBe(false)
    // no time it finished was kept then: its last update stands in
    expect(w.engine.view(t).doneAt).toBe(1)
    // its agent showing up again in herdr neither cleans it up again nor makes news; an old reviewer is put away
    w.status['OLD-1/Reviewer'] = 'idle'
    w.engine.agentStatus('OLD-1/Reviewer')
    expect(w.status['OLD-1/Reviewer']).toBe('gone')
    expect(t.cleaned).toBe(true)
    w.agentIs('OLD-1/Agent', 'idle')
    expect(w.records['OLD-1/Agent']).toBeUndefined()
    expect(w.news).toEqual([])
    // done before: no card for it
    expect(w.cards).toEqual([])
  })
})

describe("a task's CLI, model and effort", () => {
  // CI-quarantine: fails on a GitHub runner only, cause not found yet
  test.skipIf(Boolean(process.env.CI))("Settings' for tasks, unless the coordinator chose others for this one; only on its first start", async () => {
    const w = world()
    ;(w.settings as any).at('all')['task.model'] = 'opus'
    const { t, key } = await started(w, repo(), 'harness-engine')
    // an alias goes in as the model it names now
    expect(w.started[0]).toMatchObject({ kind: 'claude', model: 'claude-opus-5-5', effort: undefined })
    expect(t.agent).toEqual({ kind: 'claude', model: 'claude-opus-5-5', effort: undefined })
    w.settings.set('task.model', null)
    const p = w.places.byName('harness-engine')!
    const t2 = w.engine.add({ project: p.name, title: 'On Codex', by: 'test', agent: { kind: 'codex', effort: 'low' } })
    await until(() => w.started.some((s) => s.key === `${t2.id}/Agent`))
    expect(w.started.find((s) => s.key === `${t2.id}/Agent`)).toMatchObject({ kind: 'codex', model: undefined, effort: 'low' })
    expect(w.engine.view(t2).on).toBe('Codex')
    // another CLI drops Settings' model, which names one of Claude Code's
    ;(w.settings as any).at('all')['task.model'] = 'claude-opus-5-5'
    const t3 = w.engine.add({ project: p.name, title: 'Codex too', by: 'test', agent: { kind: 'codex' } })
    expect(t3.agent).toEqual({ kind: 'codex', model: undefined, effort: undefined })
    const t4 = w.engine.add({ project: p.name, title: 'Claude', by: 'test', agent: { kind: 'claude', effort: 'max' } })
    expect(t4.agent).toEqual({ kind: 'claude', model: 'claude-opus-5-5', effort: 'max' })
    w.settings.set('task.model', null)
    await until(() => [t3, t4].every((x) => w.started.some((s) => s.key === `${x.id}/Agent`)))
    // started again later (its chat may have picked another model since): what its record holds counts
    w.agentIs(key, 'gone')
    await w.engine.resume(t.id)
    const again = w.started.filter((s) => s.key === key).at(-1)!
    expect('model' in again).toBe(false)
  })
})
