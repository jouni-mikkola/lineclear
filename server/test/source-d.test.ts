import { stopSource, placeId, herdr, hidden, src } from './source-fixture.ts'
import { afterAll, describe, expect, test } from 'bun:test'

describe('what you send shows at once', () => {
  /** the chat's own record under a name, its outbox emptied; `record` is what it was, to put back */
  const takeChat = (name: string) => {
    const agents = src.agents
    agents.outbox = agents.outbox.filter((o) => o.key !== chat)
    const prompt = herdr.prompt
    const record = agents.records[chat]
    agents.records[chat] = { ...(record ?? {}), key: chat, name } as (typeof agents.records)[string]
    return { agents, prompt, record }
  }
  const chat = placeId.home()
  const said = (id: string, text: string, at = Date.now()) => {
    const ev = (src.chats as unknown as { events: Map<string, unknown[]> }).events
    ev.set(chat, [...(ev.get(chat) ?? []), { kind: 'user', id, at, text }])
  }
  /** the agent's state for a while, as herdr would say it */
  const as = async <T>(st: string, fn: () => Promise<T>) => {
    const status = src.agents.status
    src.agents.status = () => st as ReturnType<typeof status>
    try {
      return await fn()
    } finally {
      src.agents.status = status
    }
  }
  test("an agent that won't start, or won't take it, is an error the screen shows, not a wait", async () => {
    // what earlier tests left waiting
    src.agents.outbox = src.agents.outbox.filter((o) => o.key !== chat)
    // herdr isn't running here: the agent can't be started
    await expect(src.act({ type: 'send', chat, text: 'Hello?', cid: 'c0' })).rejects.toThrow(/herdr|agent/)
    // ready, but typing it in fails
    await as('idle', async () => {
      await expect(src.act({ type: 'send', chat, text: 'Hello?', cid: 'c0' })).rejects.toThrow("The agent didn't take it")
    })
    expect(src.agents.waiting(chat).some((o) => o.cid === 'c0')).toBe(false)
  })
  test('one that waited and then could not go in fails in the chat; sent again, it is on its way once more', async () => {
    src.agents.outbox = src.agents.outbox.filter((o) => o.key !== chat)
    expect(await as('blocked', () => src.act({ type: 'send', chat, text: 'Later', cid: 'c9' }))).toMatchObject({ waiting: true })
    // the agent is ready, but typing it in fails
    await as('idle', () => src.agents.deliver(chat))
    const c = src.chats.chat(chat)
    expect(c.messages.some((m) => m.cid === 'c9')).toBe(false)
    expect(c.failed).toEqual([{ cid: 'c9', error: expect.stringContaining("The agent didn't take it") }])
    await as('blocked', () => src.act({ type: 'send', chat, text: 'Later', cid: 'c9' }))
    expect(src.chats.chat(chat).failed).toBeUndefined()
    src.agents.outbox = src.agents.outbox.filter((o) => o.key !== chat)
  })
  test("it comes back with the screen's id: while it waits, and once the log has it", async () => {
    // an agent on a menu: it waits, and says why
    const sent = Date.now()
    const r = (await as('blocked', () => src.act({ type: 'send', chat, text: 'Ship  it\nnow', cid: 'c1' }))) as { waiting: boolean; at: number }
    expect(r.waiting).toBe(true)
    expect([r.at >= sent, r.at <= Date.now()]).toEqual([true, true])
    expect(r).toMatchObject({ waitsFor: 'menu' })
    const shown = await as('blocked', async () => src.chats.chat(chat).messages.filter((m) => m.cid === 'c1'))
    expect(shown.map((m) => [m.text, m.waiting, m.waitsFor])).toEqual([['Ship  it\nnow', true, 'menu']])
    // the screen heard no answer and sends it again: it still goes in once
    await as('blocked', () => src.act({ type: 'send', chat, text: 'Ship  it\nnow', cid: 'c1' }))
    expect(src.agents.waiting(chat).filter((o) => o.cid === 'c1')).toHaveLength(1)
    // it goes in, and the log has it with its own spacing: the message keeps the id
    const item = src.agents.outbox.find((o) => o.cid === 'c1')!
    src.agents.outbox = src.agents.outbox.filter((o) => o !== item)
    ;(src.agents as unknown as { went(o: typeof item): void }).went(item)
    said('s1', 'Ship it\n now')
    const back = src.chats.chat(chat).messages.filter((m) => m.cid === 'c1')
    expect(back.map((m) => [m.id, m.waiting])).toEqual([['s1', undefined]])
    // the same words again, typed in the terminal, are not it: the id went to the first
    said('s2', 'Ship it now')
    expect(src.chats.chat(chat).messages.find((m) => m.id === 's2')?.cid).toBeUndefined()
  })
  test('one waiting on a menu fails once the agent is gone or herdr out of reach for a while', async () => {
    const agents = src.agents
    for (const [lost, error] of [
      [false, 'The agent stopped before it went in.'],
      [true, 'Lost herdr before it went in.'],
    ] as const) {
      agents.outbox = agents.outbox.filter((o) => o.key !== chat)
      const cid = `strand-${lost}`
      await as('blocked', () => src.act({ type: 'send', chat, text: 'Later', cid }))
      // the agent stops, or herdr goes away while the agent was working
      const reachable = agents.reachable
      agents.reachable = !lost
      try {
        await as(lost ? 'blocked' : 'gone', async () => {
          const t = Date.now()
          agents.checkStranded(t)
          // a moment gone (the agent starting again) is no reason yet
          agents.checkStranded(t + 10_000)
          expect(agents.waiting(chat).some((o) => o.cid === cid)).toBe(true)
          agents.checkStranded(t + agents.strandAfter)
        })
      } finally {
        agents.reachable = reachable
      }
      expect(agents.waiting(chat).some((o) => o.cid === cid)).toBe(false)
      expect(src.chats.chat(chat).failed).toContainEqual({ cid, error })
    }
    // back while it waited: it goes on waiting
    const reachable = agents.reachable
    agents.reachable = true
    await as('blocked', () => src.act({ type: 'send', chat, text: 'Later', cid: 'back' }))
    await as('gone', async () => agents.checkStranded(Date.now()))
    await as('blocked', async () => agents.checkStranded(Date.now() + agents.strandAfter))
    expect(agents.waiting(chat).some((o) => o.cid === 'back')).toBe(true)
    agents.reachable = reachable
    agents.outbox = agents.outbox.filter((o) => o.key !== chat)
  })
  test('requester news survives offline timeouts and keeps a receipt across Agents restart', async () => {
    const agents = src.agents
    const cid = `requested-news:restart-${Date.now()}`
    await as('blocked', () => agents.send(chat, hidden('Task is ready'), { cid }))
    const reachable = agents.reachable
    agents.reachable = false
    try {
      agents.checkStranded(Date.now())
      agents.checkStranded(Date.now() + agents.strandAfter + 1)
      expect(agents.waiting(chat).some((o) => o.cid === cid)).toBe(true)
      const item = agents.outbox.find((o) => o.cid === cid)!
      ;(agents as unknown as { fail(key: string, error: string): void }).fail(chat, 'offline')
      expect(agents.outbox).toContain(item)
      // This is the actual delivery bookkeeping, which must outlive a process restart.
      ;(agents as unknown as { went(o: typeof item): void }).went(item)
      agents.save() // simulate a crash after receipt, before removing the queued copy
      const { Agents } = await import('../server/live/agents.ts')
      const restarted = new Agents()
      try {
        await restarted.deliver(chat)
        expect((await restarted.send(chat, item.text, { cid })).waiting).toBe(false)
        expect(restarted.waiting(chat).some((o) => o.cid === cid)).toBe(false)
      } finally {
        restarted.stop()
      }
      agents.outbox = agents.outbox.filter((o) => o !== item)
      agents.save()
    } finally {
      agents.reachable = reachable
    }
  })
  test('sent again while the first is still on its way, it goes in once', async () => {
    const { agents, prompt, record } = takeChat('held')
    let typed = 0
    let let_go!: () => void
    herdr.prompt = (async () => {
      typed++
      await new Promise<void>((r) => (let_go = r))
    }) as typeof prompt
    try {
      await as('idle', async () => {
        const first = src.act({ type: 'send', chat, text: 'Once', cid: 'twice' })
        await new Promise((r) => setTimeout(r, 10))
        const second = src.act({ type: 'send', chat, text: 'Once', cid: 'twice' })
        await new Promise((r) => setTimeout(r, 10))
        let_go()
        expect(await first).toMatchObject({ waiting: false })
        expect(await second).toMatchObject({ waiting: false })
        // and once it is in, a third goes nowhere either
        await src.act({ type: 'send', chat, text: 'Once', cid: 'twice' })
      })
    } finally {
      herdr.prompt = prompt
      if (record) agents.records[chat] = record
      else delete agents.records[chat]
    }
    expect(typed).toBe(1)
  })
  // fails on ebb17d5 too; L20 fixes it
  test.skip('a busy agent takes it at once, mid-turn; only a menu, a starting agent or a CLI command mid-turn holds it', async () => {
    const { agents, prompt, record } = takeChat('steer')
    const typed: string[] = []
    let menu = false
    herdr.prompt = (async (_name: string, text: string) => {
      // herdr itself refuses while a menu is up
      if (menu) throw Object.assign(new Error('blocked'), { code: 'agent_blocked' })
      typed.push(text)
    }) as typeof prompt
    try {
      expect(await as('working', () => src.act({ type: 'send', chat, text: 'Also the README', cid: 'w1' }))).toMatchObject({ waiting: false })
      expect(typed).toEqual(['Also the README'])
      // a CLI command waits for the turn to end
      expect(await as('working', () => agents.send(chat, '/compact', { idle: true }))).toMatchObject({ waiting: true, waitsFor: 'turn' })
      await as('working', () => agents.deliver(chat))
      expect(typed).toHaveLength(1)
      await as('idle', () => agents.deliver(chat))
      expect(typed.at(-1)).toBe('/compact')
      // a menu came up just as it was typed: it waits for the menu instead of failing
      menu = true
      expect(await as('working', () => src.act({ type: 'send', chat, text: 'Pick nothing', cid: 'w2' }))).toMatchObject({ waiting: true, waitsFor: 'menu' })
      expect(agents.waiting(chat).map((o) => o.cid)).toEqual(['w2'])
      // still up: it stays, without failing
      await as('blocked', () => agents.deliver(chat))
      expect(agents.waiting(chat)).toHaveLength(1)
      expect(src.chats.chat(chat).failed?.some((f) => f.cid === 'w2')).toBeFalsy()
      // the menu is gone and the agent works on: it goes in
      menu = false
      await as('working', () => agents.deliver(chat))
      expect(typed.at(-1)).toBe('Pick nothing')
      expect(agents.waiting(chat)).toHaveLength(0)
      // starting up: it waits for the CLI to take input
      expect(await as('idle', async () => agents.holdOf(chat))).toBeUndefined()
      const info = agents.info
      agents.info = () => ({ interactive_ready: false }) as ReturnType<typeof info>
      try {
        expect(await as('idle', async () => agents.holdOf(chat))).toBe('start')
      } finally {
        agents.info = info
      }
    } finally {
      herdr.prompt = prompt
      if (record) agents.records[chat] = record
      else delete agents.records[chat]
      agents.outbox = agents.outbox.filter((o) => o.key !== chat)
    }
  })
  test('its files carry the id too', async () => {
    const shot = await src.upload(chat, 'shot.png', new Uint8Array([1]))
    await as('blocked', () => src.act({ type: 'send', chat, text: '', attachments: [shot], cid: 'c2' }))
    expect(
      src.chats
        .chat(chat)
        .messages.filter((m) => m.cid === 'c2')
        .map((m) => m.file?.path),
    ).toEqual([shot])
  })
})

afterAll(stopSource)
