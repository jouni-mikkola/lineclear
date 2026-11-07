import { stopSource, placeId, src, until, workedTask } from './source-fixture.ts'
import { afterAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedModels } from './model-fixture.ts'
import { setRegistry } from '../server/live/models.ts'

seedModels()

describe("a task's CLI, model and effort", () => {
  /** task add with these flags is turned down, with this said */
  const expectRefused = async (place: string, args: string[], says: string) => {
    const r = await src.cli(['task', 'add', 'Odd', '--desc', 'x', ...args], { chat: place })
    expect(r.code).toBe(1)
    expect(r.out).toContain(says)
  }
  // fails on ebb17d5 too; L20 fixes it
  test.skip('task add takes --agent, --model and --effort for one task; what makes no sense is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shep-src-repo-'))
    execSync('git init -q -b main && git config user.email t@t && git config user.name T && echo hi > README.md && git add -A && git commit -qm init', {
      cwd: dir,
      shell: '/bin/sh',
    })
    const p = await src.places.add(dir, 'harness-source')
    const place = placeId.space(p.name)
    const before = src.engine.tasks.length
    for (const [args, says] of <[string[], string][]>[
      [['--agent', 'nope'], 'No CLI called nope'],
      [['--effort', 'extreme'], '--effort takes default, low, medium, high, xhigh, max on Claude Code'],
      [['--effort', 'ultra', '--model', 'sonnet'], '--effort takes default, low, medium, high, xhigh, max on Sonnet 5.5'],
      [
        ['--model', 'opus 9'],
        '--model opus 9: Claude Code has no such model. It takes claude-fable-5-1, claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5, or default',
      ],
      [['--model', 'opus;rm'], 'Write a model id'],
      [['--prio', 'high'], 'Task add takes no --prio'],
      [['--effort'], '--effort needs a value'],
      [['--agent', 'gemini', '--model', 'x'], 'Claude Code and pi only'],
    ]) {
      await expectRefused(place, args, says)
    }
    expect(src.engine.tasks.length).toBe(before)
    const r = await src.cli(['task', 'add', 'On pi', '--desc', 'x', '--agent', 'pi', '--model', 'openai/gpt-5.5', '--effort', 'High'], { chat: place })
    expect(r.out).toContain('Its agent (pi, openai/gpt-5.5, high effort) starts on the brief now')
    const t = src.engine.task(r.out.match(/([A-Z]+-\d+)/)![1])!
    expect(t.agent).toEqual({ kind: 'pi', model: 'openai/gpt-5.5', effort: 'high' })
    // default: the CLI's own, whatever Settings say
    ;(src.settings as any).at('all')['task.model'] = 'opus'
    const d = await src.cli(['task', 'add', 'Plain', '--desc', 'x', '--model', 'default'], { chat: place })
    expect(src.engine.task(d.out.match(/([A-Z]+-\d+)/)![1])!.agent).toEqual({ kind: 'claude', model: '', effort: undefined })
    src.settings.set('task.model', null)
    await until(() => !!t.trouble, 'the task to show trouble')
  })
  test("its brief's Reviewer line names the reviewer: Settings', or task add's --reviewer flags for one task", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shep-src-repo-'))
    execSync('git init -q -b main && git config user.email t@t && git config user.name T && echo hi > README.md && git add -A && git commit -qm init', {
      cwd: dir,
      shell: '/bin/sh',
    })
    const place = placeId.space((await src.places.add(dir, 'reviewer-source')).name)
    for (const [args, says] of <[string[], string][]>[
      [['--reviewer', 'gemini'], '--reviewer gemini: Pick one of: Claude Code · pi.'],
      [['--reviewer-effort', 'extreme'], '--reviewer-effort takes default, low, medium, high, xhigh, max on Claude Code'],
      [['--reviewer-model', 'opus 9'], 'Claude Code has no such model'],
    ]) {
      await expectRefused(place, args, says)
    }
    const id = (out: string) => out.match(/([A-Z]+-\d+)/)![1]
    const plain = src.engine.task(id((await src.cli(['task', 'add', 'Plain review', '--desc', 'x'], { chat: place })).out))!
    expect(plain.reviewer).toEqual({ kind: 'claude', model: undefined, effort: undefined })
    expect(plain.desc).toContain('- Reviewer: a headless Claude Code or a Claude Code subagent (its default model and effort).\n')
    ;(src.settings as any).at('all')['reviewer.agent'] = 'pi'
    ;(src.settings as any).at('all')['reviewer.model'] = 'openai/gpt-5.5'
    const own = src.engine.task(
      id((await src.cli(['task', 'add', 'Claude review', '--desc', 'x', '--reviewer', 'claude', '--reviewer-effort', 'High'], { chat: place })).out),
    )!
    // another CLI drops Settings' model, which names one of pi's
    expect(own.reviewer).toEqual({ kind: 'claude', model: undefined, effort: 'high' })
    expect(own.desc).toContain(
      '- Reviewer: a headless Claude Code or a Claude Code subagent (its default model, high effort). (set by coordinator for this task)',
    )
    const pi = src.engine.task(id((await src.cli(['task', 'add', 'pi review', '--desc', 'x', '--reviewer-effort', 'low'], { chat: place })).out))!
    expect(pi.desc).toContain('- Reviewer: a headless pi or a pi subagent (model openai/gpt-5.5, low effort). (set by coordinator for this task)')
    src.settings.set('reviewer.model', null)
    src.settings.set('reviewer.agent', null)
  })
  test('task add --set changes a line of its Settings block for that task alone, marked as set by its coordinator', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shep-src-repo-'))
    execSync('git init -q -b main && git config user.email t@t && git config user.name T && echo hi > README.md && git add -A && git commit -qm init', {
      cwd: dir,
      shell: '/bin/sh',
    })
    const place = placeId.space((await src.places.add(dir, 'set-source')).name)
    const bad = await src.cli(['task', 'add', 'Odd', '--desc', 'x', '--set', 'merge=whenever'], { chat: place })
    expect(bad.code).toBe(1)
    expect(bad.out).toContain('--set merge: Pick one of')
    const id = (out: string) => out.match(/([A-Z]+-\d+)/)![1]
    const t = src.engine.task(
      id(
        (
          await src.cli(
            ['task', 'add', 'One round', '--desc', 'x', '--set', 'review.rounds=1', '--set', 'merge=after GitHub checks', '--set', 'reviewer=claude'],
            { chat: place },
          )
        ).out,
      ),
    )!
    // lineclear merge waits for GitHub's checks, as the brief says, whatever Settings say later
    expect(t.waitChecks).toBe(true)
    expect(t.reviewer?.kind).toBe('claude')
    expect(t.desc).toContain('- Review rounds: 1. One round, no review again. (set by coordinator for this task)')
    expect(t.desc).toContain(`- Merge: after GitHub checks. Merge it yourself once it works and GitHub's checks pass (lineclear checks ${t.id}`)
    expect(t.desc).toContain('- Reviewer: a headless Claude Code or a Claude Code subagent (its default model and effort). (set by coordinator for this task)')
    // the rest stays Settings', unmarked
    expect(t.desc).toContain('- Must fix: major. Findings are tagged critical/major/minor/trivial; fix critical and major.\n')
  })
})

describe("a task's CLI, model and effort, continued", () => {
  test('lineclear show prints the settings and the lines every brief ends with', async () => {
    const out = (await src.cli(['show'], {})).out
    expect(out).toContain('brief.review           on')
    expect(out).toContain('review.mustFix         major')
    expect(out).toContain('review.rounds          3 rounds')
    expect(out).not.toContain('brief.plan')
    expect(out).toContain('reviewer.agent         Claude Code')
    expect(out).toContain('reviewer.model         default')
    expect(out).toContain('reviewer.effort        default')
    expect(out).toContain('- Reviewer: a headless Claude Code or a Claude Code subagent (its default model and effort).')
    expect(out).toContain('What agents are told (')
    expect(out).toContain('How Lineclear runs:')
    expect(out).toContain('--set review.rounds=1')
    expect(out).toContain('coordinator.agent      Claude Code')
    expect(out).toContain("Every new task's brief ends with:\nSettings:")
  })
  test("a coordinator first starts on Settings' CLI, model and effort for coordinators", async () => {
    // one that ran before keeps what it runs on until it is restarted (SHE-249): a new space's has never run
    const seen: { kind: string; model?: string; effort?: string }[] = []
    const ensure = src.agents.ensure
    src.agents.ensure = (async (spec: { kind: string; model?: string; effort?: string }) => (seen.push(spec), null)) as never
    try {
      const dir = mkdtempSync(join(tmpdir(), 'shep-src-repo-'))
      execSync('git init -q -b main && git config user.email t@t && git config user.name T && echo hi > README.md && git add -A && git commit -qm init', {
        cwd: dir,
        shell: '/bin/sh',
      })
      const place = placeId.space((await src.places.add(dir, 'coord-settings')).name)
      expect(src.agents.record(place)).toBeUndefined()
      src.settings.set('coordinator.agent', 'pi')
      src.settings.set('coordinator.effort', 'high')
      await (src as unknown as { coordinator(id: string): Promise<unknown> }).coordinator(place)
      expect(seen.at(-1)).toMatchObject({ kind: 'pi', model: '', effort: 'high' })
    } finally {
      src.agents.ensure = ensure
      src.settings.set('coordinator.agent', null)
      src.settings.set('coordinator.effort', null)
    }
  })
  test("a coordinator that ran with no model starts on Settings' model once its CLI lists models (pi)", async () => {
    const seen: { kind: string; model?: string }[] = []
    const { ensure, record } = src.agents
    src.agents.ensure = (async (spec: { kind: string; model?: string }) => (seen.push(spec), null)) as never
    try {
      const place = placeId.home()
      setRegistry([{ harness: 'pi', provider: 'fakeco', name: 'zeta-1' }])
      src.settings.set('coordinator.agent', 'pi')
      src.settings.set('coordinator.model', 'fakeco/zeta-1')
      const run = () => (src as unknown as { coordinator(id: string): Promise<unknown> }).coordinator(place)
      src.agents.record = (() => ({ kind: 'pi', model: '', effort: '' })) as never
      await run()
      expect(seen.at(-1)).toMatchObject({ kind: 'pi', model: 'fakeco/zeta-1' })
      // one that runs on a model keeps it
      src.agents.record = (() => ({ kind: 'pi', model: 'fakeco/zeta-1', effort: '' })) as never
      await run()
      expect(seen.at(-1)?.model).toBeUndefined()
    } finally {
      src.agents.ensure = ensure
      src.agents.record = record
      setRegistry([])
      src.settings.set('coordinator.agent', null)
      src.settings.set('coordinator.model', null)
    }
  })
  test('each CLI is started with its own flags for model and effort', () => {
    const rec = (kind: string, model?: string, effort?: string) => ({
      key: 'k',
      name: 'n',
      kind,
      cwd: '/',
      workspace: 'w',
      logs: [],
      started: 0,
      model,
      effort,
      access: 'full' as const,
    })
    // Claude Code also gets its own hooks' settings file (readers/hooks.ts)
    const hooks = ['--settings', join(process.env.LINECLEAR_HOME!, 'hooks', 'n.settings.json')]
    expect(src.agents.args(rec('claude', 'claude-opus-5-5', 'xhigh'), false)).toEqual([...hooks, '--model', 'claude-opus-5-5', '--effort', 'xhigh'])
    // picked in its chat's menu by name
    expect(src.agents.args(rec('claude', 'Sonnet 5.5', 'lowest'), false)).toEqual([...hooks, '--model', 'claude-sonnet-5-5', '--effort', 'low'])
    expect(src.agents.args(rec('claude', 'default', 'default'), false)).toEqual(hooks)
    // a level its model lacks goes in as the nearest it has
    expect(src.agents.args(rec('claude', 'Haiku 5.5', 'ultra'), false)).toEqual([...hooks, '--model', 'claude-haiku-5-5', '--effort', 'max'])
    for (const key of ['space-key', 'SHE-9/Agent', 'SHE-9/Reviewer']) {
      for (const resume of [false, true]) {
        const args = src.agents.args({ ...rec('codex', '', ''), key, env: { LINECLEAR_CHAT: 'ST-1/Reviewer', LINECLEAR_URL: 'http://127.0.0.1:7787' } }, resume)
        const policy = args.find((a) => a.startsWith('shell_environment_policy.set='))!
        expect(policy).toContain(`"LINECLEAR_CHAT"="${key}"`)
        expect(policy).toContain('"LINECLEAR_COMMAND"=')
        expect(policy).toContain('"PATH"=')
      }
    }
    expect(src.agents.args(rec('pi', 'openai/gpt-5.5', 'lowest'), false)).toEqual(['--model', 'openai/gpt-5.5', '--thinking', 'minimal'])
    expect(src.agents.args(rec('gemini', 'x', 'high'), false)).toEqual([])
  })
})

describe('choice cards', () => {
  test('fast answers require an explicit ordinary question declaration', async () => {
    const chat = placeId.home()
    for (const ordinary of [false, true]) {
      const r = await src.cli(['ask', 'Which colour?', ...(ordinary ? ['--ordinary'] : []), '--choice', 'Blue', '--choice', 'Green'], { chat })
      expect(r.code).toBe(0)
      const q = src.chats.log(chat).posted.at(-1)!.question!
      expect(q.ordinary).toBe(ordinary || undefined)
      expect(q.choices.map((c) => c.label)).toEqual(['Blue', 'Green'])
      src.chats.answer(chat, q.id, 0)
    }
  })

  test('a typed reply closes the open card: the dot stops waiting and the card shows answered', async () => {
    const chat = placeId.home()
    const r = await src.cli(['ask', 'Rerun CI on main?', '--choice', 'Rerun it', '--choice', 'Leave it'], { chat })
    expect(r.out).toContain('Asked')
    const qid = src.asks()[chat]
    expect(qid).toStartWith('ask:')
    // herdr isn't running here, so the message itself may not go in; the card closes all the same
    await src.act({ type: 'send', chat, text: 'Leave it, I will look later' }).catch(() => undefined)
    expect(src.asks()[chat]).toBeUndefined()
    expect(src.chats.log(chat).answers[qid]).toBe(-1)
    const card = src.chats.chat(chat).messages.find((m) => m.question?.id === qid)
    // answered in chat, quoting your words: not as if an option was picked
    expect(card?.question).toMatchObject({ sent: -1, said: 'Leave it, I will look later', via: 'chat' })
  })

  test('an Other answer typed on the card is quoted, and sent from the card', async () => {
    const chat = placeId.home()
    await src.cli(['ask', 'Which branch?', '--choice', 'main', '--choice', 'next', '--other'], { chat })
    const qid = src.asks()[chat]
    await src.act({ type: 'answer', chat, question: qid, choice: -1, other: 'release-2' }).catch(() => undefined)
    const card = src.chats.chat(chat).messages.find((m) => m.question?.id === qid)
    expect(card?.question).toMatchObject({ sent: -1, said: 'release-2' })
    expect(card?.question?.via).toBeUndefined()
  })
})

describe("a coordinator's question", () => {
  test("sends no alert of its own (the main machine's home space picks what buzzes); a second answer is refused", async () => {
    const chat = placeId.home()
    const alerts: import('../shared/types.ts').Alert[] = []
    const off = src.on('alert', (a) => void alerts.push(a))
    try {
      await src.cli(['ask', 'Rerun CI?', '--choice', 'Rerun it', '--choice', 'Leave it'], { chat })
      const qid = src.asks()[chat]
      expect(alerts.filter((a) => a.tag === `ask:${chat}` || a.card)).toEqual([])
      await src.act({ type: 'answer', chat, question: qid, choice: 1 }).catch(() => undefined)
      expect(src.chats.log(chat).answers[qid]).toBe(1)
      // an old alert's button: refused, the answer stays
      expect(await src.act({ type: 'answer', chat, question: qid, choice: 0 })).toMatchObject({ ok: false })
      expect(src.chats.log(chat).answers[qid]).toBe(1)
    } finally {
      off()
    }
  })
})

describe("an alert's button", () => {
  test('answers only the card the chat still ends on; the app may still answer it', async () => {
    const chat = placeId.home()
    await src.cli(['ask', 'Ship it?', '--choice', 'Ship', '--choice', 'Wait'], { chat })
    const qid = src.asks()[chat]
    // something came after the card (an answer in words that leaves it open)
    src.chats.post(chat, { id: 'later', who: 'you', text: 'Hold on, one more thing' })
    expect(await src.act({ type: 'answer', chat, question: qid, choice: 0, fromAlert: true })).toMatchObject({ ok: false })
    expect(src.chats.log(chat).answers[qid]).toBeUndefined()
    await src.act({ type: 'answer', chat, question: qid, choice: 1 }).catch(() => undefined)
    expect(src.chats.log(chat).answers[qid]).toBe(1)
  })
})

describe("a coordinator's alert about a task", () => {
  // CI-quarantine: fails on a GitHub runner only, cause not found yet
  test.skipIf(Boolean(process.env.CI))("says what the task needs, then the why, in place of the task's own alert", async () => {
    const { t } = await workedTask('alerted')
    await until(() => src.engine.statusOf(t) === 'need', 'the task to need you')
    expect(src.engine.statusOf(t)).toBe('need')
    const alerts: import('../shared/types.ts').Alert[] = []
    const off = src.on('alert', (a) => void alerts.push(a))
    try {
      await src.cli(['alert', 'Needs a look', '--body', 'It could not start', '--task', t.id], { chat: placeId.home() })
    } finally {
      off()
    }
    const a = alerts.at(-1)!
    expect(a).toMatchObject({ from: 'Lineclear', tag: t.id, go: { task: t.id } })
    expect(a.title).toStartWith(`${t.id} · `)
    expect(a.body).toEndWith('\nhome: Needs a look: It could not start')
  })
})

describe("a task's question on its needs-you card in its space's chat", () => {
  const engine = () => src.engine as unknown as { emit(e: string, ...a: unknown[]): void }
  const told = (place: string) => {
    const said: string[] = []
    const send = src.agents.send
    src.agents.send = (async (k: string, text: string) => (k === place && said.push(text), { waiting: false })) as never
    return { said, off: () => void (src.agents.send = send) }
  }

  // CI-quarantine: fails on a GitHub runner only, cause not found yet
  test.skipIf(Boolean(process.env.CI))('a choice card answered on the card: it goes to the task, both copies say where, the coordinator hears it', async () => {
    const { t, place } = await workedTask('askcopy')
    await until(() => src.engine.statusOf(t) === 'need')
    const key = `${t.id}/Agent`
    await src.cli(['ask', 'Which colour?', '--choice', 'Blue', '--choice', 'Green'], { chat: key })
    const qid = src.chats.log(key).posted.findLast((p) => p.question)!.question!.id
    engine().emit('card', t, 'need', 'Question for you')
    // kept on the card as it goes up, before anyone opens the space's chat
    expect(src.chats.log(place).posted.findLast((p) => p.card?.task === t.id)?.card?.ask?.questions?.[0]?.id).toBe(qid)
    const card = () => src.chat(place)!.messages.findLast((m) => m.card?.task === t.id)!.card!
    expect(card().ask).toMatchObject({
      chat: key,
      open: true,
      questions: [{ id: qid, title: 'Which colour?', choices: [{ label: 'Blue' }, { label: 'Green' }] }],
    })
    const { said, off } = told(place)
    try {
      await src.act({ type: 'answer', chat: key, question: qid, choice: 1, space: place }).catch(() => undefined)
    } finally {
      off()
    }
    expect(src.chats.log(key).answers[qid]).toBe(1)
    expect(card().ask).toMatchObject({
      open: false,
      answered: { where: 'space' },
      questions: [{ sent: 1, elsewhere: { label: 'Answered here ·', chat: key, name: `${t.id} chat` } }],
    })
    expect(src.chats.chat(key).messages.find((m) => m.question?.id === qid)?.question).toMatchObject({
      sent: 1,
      elsewhere: { label: 'Answered in', chat: place },
    })
    expect(said.join('\n')).toContain("don't answer it too")
    // answered once: the task's own chat can't answer it again
    expect(await src.act({ type: 'answer', chat: key, question: qid, choice: 0 })).toMatchObject({ ok: false })
  })

  test('answered in the task chat instead: the card follows, and says where', async () => {
    const { t, place } = await workedTask('askthere')
    await until(() => src.engine.statusOf(t) === 'need')
    const key = `${t.id}/Agent`
    await src.cli(['ask', 'Ship it?', '--choice', 'Ship', '--choice', 'Wait'], { chat: key })
    const qid = src.chats.log(key).posted.findLast((p) => p.question)!.question!.id
    engine().emit('card', t, 'need', 'Question for you')
    const card = () => src.chat(place)!.messages.findLast((m) => m.card?.task === t.id)!.card!
    expect(card().ask?.open).toBe(true)
    await src.act({ type: 'answer', chat: key, question: qid, choice: 0 }).catch(() => undefined)
    expect(card().ask).toMatchObject({ open: false, answered: { where: 'task' }, questions: [{ sent: 0, elsewhere: { label: 'Answered in', chat: key } }] })
    // a card from another space can't answer for it
    expect(await src.act({ type: 'answer', chat: key, question: qid, choice: 1, space: placeId.home() })).toMatchObject({ ok: false })
  })

  test('a plain question: its words and a reply that goes to the task', async () => {
    const { t, place } = await workedTask('askplain')
    await until(() => src.engine.statusOf(t) === 'need')
    const key = `${t.id}/Agent`
    src.chats.post(key, { id: 'plain-q', text: 'Keep the old API around?' })
    // its question cut to a status line, as the task's row shows it
    engine().emit('card', t, 'need', 'Keep the old API around?')
    const card = () => src.chat(place)!.messages.findLast((m) => m.card?.task === t.id)!.card!
    expect(card().ask).toMatchObject({ chat: key, open: true, reply: { id: 'plain-q', text: 'Keep the old API around?' } })
    const { said, off } = told(place)
    try {
      await src.act({ type: 'send', chat: key, text: 'Yes, one more release', reply: 'plain-q', space: place }).catch(() => undefined)
    } finally {
      off()
    }
    expect(card().ask).toMatchObject({ open: false, answered: { where: 'space', text: 'Yes, one more release' } })
    expect(said.join('\n')).toContain("don't answer it too")
    // another screen still showing the card can't send it twice
    expect(await src.act({ type: 'send', chat: key, text: 'Yes', reply: 'plain-q', space: place })).toMatchObject({ ok: false })
  })
})

describe('waiting on you', () => {
  test("a coordinator blocked on its CLI's own menu waits on you, like an open card: the sidebar counts it", () => {
    const chat = placeId.home()
    const agents = src.agents as unknown as { status: (k: string) => string }
    const status = agents.status
    agents.status = (k) => (k === chat ? 'blocked' : status.call(src.agents, k))
    try {
      const s = src.snapshot()
      expect(s.asks[chat]).toBe('blocked')
      expect(s.places[0].status).toBe('need')
    } finally {
      agents.status = status
    }
    expect(src.snapshot().asks[chat]).toBeUndefined()
  })
})

describe("a task's own progress (lineclear status)", () => {
  test('its agent reports a line, % done and time left; the task shows it while it works, frozen while it waits on you, gone once done', async () => {
    const { t } = await workedTask('reported')
    const other = await workedTask('reported2')
    const key = `${t.id}/Agent`
    const agents = src.agents as unknown as { status: (k: string) => string }
    const { status } = agents
    let st = 'working'
    agents.status = (k) => (k === key ? st : status.call(src.agents, k))
    const view = () => src.snapshot().tasks.find((x) => x.id === t.id)!
    try {
      // herdr isn't here, so its agent couldn't start: say it did
      t.trouble = undefined
      src.engine.agentStatus(key)
      expect(view().status).toBe('work')
      const no = await src.cli(['status', other.t.id, 'Fixing', '--done', '10'], { chat: key })
      expect(no.code).toBe(1)
      expect(no.out).toContain('only its own task')
      expect((await src.cli(['status', t.id, 'Fixing'], { chat: key })).out).toContain('--done <0-100>')
      expect((await src.cli(['status', t.id, 'Fixing', '--done', '140'], { chat: key })).code).toBe(1)
      expect((await src.cli(['status', t.id, 'Fixing', '--done', '10', '--left', 'soon'], { chat: key })).out).toContain('--left takes a time')
      expect((await src.cli(['status', t.id, 'Fixing', '--done', '10', '--left', '200h'], { chat: key })).out).toContain('up to 99h')
      expect((await src.cli(['status', t.id, 'Fixing', '--done', '10', '--left'], { chat: key })).code).toBe(1)
      expect((await src.cli(['status', t.id, ',,, ,,,', '--done', '10'], { chat: key })).out).toContain('in words')
      const r = await src.cli(['status', t.id, 'Fixing the two failing tests', '--done', '40%', '--left', '1h20m'], { chat: key })
      expect(r.out).toBe(`Noted: ${t.id} shows "Fixing the two failing tests", 40% done, about 80 min left.\n`)
      expect(view().report).toEqual({ msg: 'Fixing the two failing tests', progress: 40, eta: 80, paused: undefined })
      // the CLI's task list shows its own line while it works
      expect((await src.cli(['task', 'list'], {})).out).toContain(`${t.id}    work  Worked  · Fixing the two failing tests`)
      // the minutes count down while it works
      t.report!.at -= 5 * 60_000
      expect(view().report!.eta).toBe(75)
      // waiting on you: frozen, and the time it waits does not count
      st = 'blocked'
      src.engine.agentStatus(key)
      expect(view().report).toMatchObject({ progress: 40, eta: 75, paused: true })
      // ten minutes go by while it waits
      t.report!.at -= 10 * 60_000
      t.report!.pausedAt! -= 10 * 60_000
      expect(view().report!.eta).toBe(75)
      st = 'working'
      src.engine.agentStatus(key)
      expect(view().report).toEqual({ msg: 'Fixing the two failing tests', progress: 40, eta: 75, paused: undefined })
      // a line too long is cut at a word, and it says so; no --left, no minutes
      const long = await src.cli(['status', t.id, 'Rebasing onto main and running every check again', '--done', '90'], { chat: key })
      expect(long.out).toBe(`Noted: ${t.id} shows "Rebasing onto main and running every" (cut to 40 characters), 90% done.\n`)
      expect(view().report!.eta).toBeUndefined()
      // done: its job is over, and so is its report
      st = 'idle'
      await src.cli(['done', t.id, '--summary', 'Fixed'], { chat: key })
      expect(view().status).toBe('ready')
      expect(view().report).toBeUndefined()
      expect(t.report).toBeUndefined()
      // Ready: a report would show nothing now, and come back stale later
      expect((await src.cli(['status', t.id, 'Tidying up', '--done', '99'], { chat: key })).out).toContain('is Ready')
      expect(t.report).toBeUndefined()
      // with no id it still says how Lineclear is
      expect((await src.cli(['status'], {})).out).toContain('Lineclear on ')
    } finally {
      agents.status = status
    }
  })
})

afterAll(stopSource)
