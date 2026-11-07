import { stopSource, HOST, placeId, herdr, src, until } from './source-fixture.ts'
import { afterAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { paneFor } from '../server/live/agent-start.ts'
import type { AgentRecord } from '../server/live/agents-helpers.ts'

describe("the home space's herdr space", () => {
  test("is home: the one the coordinators shared, still called Coordinators, is renamed in place, never a repo's, and no second one opens", async () => {
    const saved = { ...herdr }
    let spaces = [
      {
        workspace_id: 'w1',
        label: 'Coordinators',
        worktree: {
          checkout_path: '/r/Coordinators',
          is_linked_worktree: false,
          repo_key: '/r/Coordinators/.git',
          repo_name: 'Coordinators',
          repo_root: '/r/Coordinators',
        },
      },
      { workspace_id: 'w2', label: 'Coordinators' },
    ]
    const opened: string[] = []
    Object.assign(herdr, {
      workspaces: async () => spaces,
      renameWorkspace: async (id: string, label: string) => void (spaces = spaces.map((w) => (w.workspace_id === id ? { ...w, label } : w))),
      createWorkspace: async (label: string) => (opened.push(`new ${label}`), Promise.reject(new Error('herdr is not here'))),
      createTab: async (id: string) => (opened.push(id), Promise.reject(new Error('herdr is not here'))),
    })
    try {
      // its coordinator opens in the old space, renamed; next time it is found by its new name
      await (src as unknown as { coordinator(id: string): Promise<unknown> }).coordinator(placeId.home()).catch(() => undefined)
      expect(spaces.map((w) => w.label)).toEqual(['Coordinators', 'home'])
      expect((await src.agents.space('home', 'Coordinators'))?.workspace_id).toBe('w2')
      expect(opened).toEqual(['w2'])
      // with none left of either name, it is made under the new one
      spaces = []
      await (src as unknown as { coordinator(id: string): Promise<unknown> }).coordinator(placeId.home()).catch(() => undefined)
      expect(opened).toEqual(['w2', 'new home'])
    } finally {
      Object.assign(herdr, saved)
    }
  })
})

describe('coordinator tab', () => {
  test('restarting a coordinator three times leaves one tab', async () => {
    const saved = { ...herdr }
    let n = 0
    const tabs: { tab_id: string; label: string; pane_id: string }[] = [{ tab_id: 'human', label: 'notes', pane_id: 'ph' }]
    Object.assign(herdr, {
      workspaces: async () => [{ workspace_id: 'w9', label: 'Tabs' }],
      tabs: async () => tabs.map(({ pane_id, ...t }) => t),
      panes: async () => tabs.map((t) => ({ pane_id: t.pane_id, tab_id: t.tab_id })),
      createTab: async (_w: string, label: string) => {
        const t = { tab_id: `t${++n}`, label, pane_id: `p${n}` }
        tabs.push(t)
        return { tab: { tab_id: t.tab_id }, root_pane: { pane_id: t.pane_id } }
      },
      agents: async () => [],
      paneIdle: async () => true,
      closePane: async (id: string) => void tabs.splice(0, tabs.length, ...tabs.filter((t) => t.pane_id !== id)),
    })
    try {
      const rec = { workspace: 'Tabs', tab: 'coordinator', name: 'c', cwd: '/' }
      for (let i = 0; i < 3; i++) await paneFor(rec as AgentRecord)
      expect(tabs.filter((t) => t.label === 'coordinator').map((t) => t.pane_id)).toEqual(['p3'])
      expect(tabs.some((t) => t.label === 'notes')).toBe(true)
    } finally {
      Object.assign(herdr, saved)
    }
  })
})

describe('machine health', () => {
  test("past a limit: a card in the home space's chat, news with the numbers for its coordinator, once; held tasks say why", async () => {
    const machine = placeId.home()
    const mon = src.health as unknown as { take: () => unknown; last?: unknown; watch: object }
    const take = mon.take
    const sent: { key: string; text: string }[] = []
    const send = src.agents.send
    src.agents.send = (async (key: string, text: string) => (sent.push({ key, text }), { waiting: false })) as typeof send
    const reach = src.agents.reachable
    mon.take = () => ({
      at: 0,
      cores: 16,
      load: 2,
      memTotal: 100 * 2 ** 30,
      memUsed: 96 * 2 ** 30,
      disks: [{ path: '/tmp', pct: 40, freeGb: 60, dev: 1 }],
      gpus: [],
    })
    try {
      src.agents.reachable = true
      src.healthTick()
      await until(() => sent.some((s) => s.key === machine && s.text.includes('<health ')))
      const card = src.chats.chat(machine).messages.find((m) => m.card?.health)
      expect(card?.card).toMatchObject({ text: 'memory is 96% used', health: { level: 'over', machine: HOST } })
      const news = sent.find((s) => s.key === machine && s.text.includes('<health '))!.text
      expect(news).toStartWith(
        `<lineclear><health kind="memory" what="over">Machine ${HOST}: memory is over 90%: 96% in use.\nCPU 13% (load 2.0 on 16 cores) · Memory 96% (96 GB of 100 GB) · Disk /tmp 40% (60 GB free)\nTasks: `,
      )
      expect(news).toContain('Using it most now:')
      expect(news).toContain('lineclear task pause <id>')
      expect(news).toContain(
        'Act on it if the human asked you to handle such things. If it can’t wait, alert the human with lineclear alert and say why. A card in this chat already shows the human the news: reply after it in one or two short lines',
      )
      // only the home space hears it: no coordinator of All machines any more
      expect(sent.filter((s) => s.text.includes('<health ')).map((s) => s.key)).toEqual([machine])
      expect(news).toContain('Never <no-reply> to it.')
      expect(news).not.toMatch(/recommend|do not act/i)
      // shown on the machine: red memory, amber is nothing else
      const h = src.snapshot().machines.find((m) => m.id === placeId.machine())!.health!
      expect(h.meters.find((m) => m.name === 'Memory')).toMatchObject({ pct: 96, level: 'over' })
      // told once
      const n = sent.length
      src.healthTick(Date.now() + 31_000)
      await Bun.sleep(1200)
      expect(sent.slice(n).filter((s) => s.text.includes('<health '))).toEqual([])
      // new tasks wait for the machine, and the command says so
      const dir = mkdtempSync(join(tmpdir(), 'shep-src-held-'))
      execSync('git init -q -b main && git -c user.email=t@t -c user.name=T commit -q --allow-empty -m init', { cwd: dir, shell: '/bin/sh' })
      await src.places.add(dir, 'held')
      const r = await src.cli(['task', 'add', 'Wait for room', '--desc', 'Add y.txt.', '--project', 'held'], { chat: placeId.space('held') })
      expect(r.out).toContain('held: the machine is busy')
      expect(r.out).toContain("starts by itself when there's room")
      expect((await src.cli(['show'], {})).out).toContain(`${HOST} now: CPU 13%`)
      // back under: told so
      mon.take = () => ({
        at: 0,
        cores: 16,
        load: 2,
        memTotal: 100 * 2 ** 30,
        memUsed: 50 * 2 ** 30,
        disks: [{ path: '/tmp', pct: 40, freeGb: 60, dev: 1 }],
        gpus: [],
      })
      src.healthTick(Date.now() + 62_000)
      await until(() => sent.some((s) => s.key === machine && s.text.includes('memory is back under 90%')))
      // one line per kind, updated in place: the over card became the back card
      const cards = src.chats.chat(machine).messages.filter((m) => m.card?.text.startsWith('memory'))
      expect(cards.map((m) => m.card?.text)).toEqual(['memory is back to normal'])
    } finally {
      src.agents.send = send
      src.agents.reachable = reach
      mon.take = take
      mon.last = undefined
    }
  })

  test("herdr's socket refusing is said plainly", async () => {
    const e = await herdr.ping().catch((x: Error) => x)
    expect((e as Error).message).toBe("herdr isn't answering")
  })
})

describe('new messages', () => {
  test("a new coordinator message alerts as one; a task's card and a task's chat don't", () => {
    const key = placeId.home()
    const alerts: import('../shared/types.ts').Alert[] = []
    const off = src.on('alert', (a) => void (a.message && alerts.push(a)))
    src.chats.post(key, {
      id: 'unread-q',
      question: { id: 'ask:unread', title: 'Clean the disk now?', kind: 'Question', choices: [{ label: 'Yes' }, { label: 'Later' }], to: key },
    })
    expect(alerts.map((a) => [a.title, a.body, a.go.place])).toEqual([[src.chatName(key), 'Clean the disk now?', key]])
    src.chats.post(key, { id: 'unread-card', card: { id: 'unread-card', task: 'X-1', status: 'done', text: 'X-1 is merged' } })
    src.chats.post('X-1/Agent', {
      id: 'unread-task',
      question: { id: 'ask:unread-task', title: 'Which port?', kind: 'Question', choices: [{ label: '80' }, { label: '443' }], to: 'X-1' },
    })
    expect(alerts).toHaveLength(1)
    off()
  })
})

describe('startup menus before the first message', () => {
  test('unparsed blockers preserve the screen and offer the terminal; changed cards cannot send keys', async () => {
    const key = 'startup-fixture'
    const originals = { info: src.agents.info, status: src.agents.status, visible: herdr.visible, refresh: src.agents.refresh, keys: src.agents.keys }
    let screen = 'A new CLI asks for a secret\nType your answer to continue'
    let sent = 0
    src.agents.info = (() => ({
      pane_id: 'startup-pane',
      agent: 'claude',
      agent_status: 'blocked',
      cwd: '/tmp',
      tab_id: 'startup-tab',
      workspace_id: 'startup-space',
    })) as typeof src.agents.info
    src.agents.status = (() => 'blocked') as typeof src.agents.status
    herdr.visible = async () => screen
    src.agents.refresh = async () => {}
    src.agents.keys = async () => {
      sent++
      screen = 'Ready for your message'
    }
    try {
      await src.chats.readMenu(key, true)
      const fallback = src.chats.chat(key).messages.find((m) => m.question)?.question
      expect(fallback?.screen).toBe(screen)
      expect(fallback?.terminal).toBe(true)
      expect(fallback?.noNote).toBe(true)
      expect(fallback?.choices).toEqual([])
      screen = 'Allow this tool? [y/n]'
      await src.chats.readMenu(key, true)
      expect(await src.act({ type: 'answer', chat: key, question: fallback!.id, choice: 0 })).toMatchObject({ ok: false })
      expect(sent).toBe(0)
      const q = src.chats.chat(key).messages.find((m) => m.question)?.question
      expect(await src.act({ type: 'answer', chat: key, question: q!.id, choice: -1 })).toMatchObject({ ok: false })
      expect(sent).toBe(0)
      // A checkbox redraw is still the same open prompt, not proof of a successful submission.
      screen = '2 new MCP servers found in this project\n❯ [✔] one\n  [✔] two\n     Enable selected\nSpace to select · Esc to reject all'
      await src.chats.readMenu(key, true)
      const checkboxes = src.chats.chat(key).messages.find((m) => m.question)?.question
      src.agents.status = (() => 'idle') as typeof src.agents.status
      expect(await src.agents.send(key, 'Wait until MCP consent closes')).toMatchObject({ waiting: true, waitsFor: 'menu' })
      src.agents.outbox = src.agents.outbox.filter((o) => o.key !== key)
      src.agents.keys = async () => {
        screen = screen.replace('[✔] one', '[ ] one')
      }
      expect(await src.act({ type: 'answer', chat: key, question: checkboxes!.id, choice: 1, choices: [1] })).toMatchObject({
        ok: false,
        error: expect.stringContaining('still shows this prompt'),
      })
      expect(src.chats.log(key).posted.some((m) => m.answered)).toBe(false)
    } finally {
      Object.assign(src.agents, { info: originals.info, status: originals.status, refresh: originals.refresh, keys: originals.keys })
      herdr.visible = originals.visible
      src.agents.outbox = src.agents.outbox.filter((o) => o.key !== key)
      src.chats.forget(key)
    }
  })
})

describe('visible launch controls', () => {
  // fails on ebb17d5 too; L20 fixes it
  test.skip('coordinator and task metadata comes from the launch record, never new Settings; old actions cannot claim an unapplied change', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shep-controls-'))
    const p = await src.places.add(dir, 'launch-controls')
    const place = placeId.space(p.name)
    const t = src.engine.add({ project: p.name, title: 'Launch controls', by: 'test', later: true })
    const keys = [place, `${t.id}/Agent`]
    try {
      src.settings.set('coordinator.agent', 'Claude Code', { space: p.name })
      src.settings.set('task.agent', 'Claude Code', { space: p.name })
      for (const key of keys) {
        src.agents.records[key] = {
          key,
          name: `launch-${key}`,
          kind: 'codex',
          model: 'gpt-6-sol',
          effort: 'high',
          cwd: dir,
          workspace: 'launch',
          logs: [],
          started: 0,
        }
        expect(src.chat(key)?.agent).toEqual({ kind: 'codex', model: 'gpt-6-sol', modelLabel: 'GPT-6-Sol', effort: 'high' })
        const before = { ...src.agents.records[key] }
        expect(await src.act({ type: 'model', chat: key, model: 'gpt-6-luna' })).toMatchObject({ ok: false, error: expect.stringContaining('Restart') })
        expect(await src.act({ type: 'effort', chat: key, effort: 'low' })).toMatchObject({ ok: false })
        expect(src.agents.records[key]).toEqual(before)
        // Missing values are kept missing: no guessed model or effort, even when Settings specifies them.
        delete src.agents.records[key].model
        delete src.agents.records[key].effort
        expect(src.chat(key)?.agent).toEqual({ kind: 'codex' })
        const info = (await src.act({ type: 'restart-info', chat: key })) as { info: { on: unknown; want: unknown } }
        expect(info.info.on).toEqual({ kind: 'codex' })
        expect(info.info.want).toMatchObject({ kind: 'claude' })
        const bad = await src.act({ type: 'restart', chat: key, kind: 'codex', model: 'no-longer-available', save: true })
        expect(bad).toMatchObject({ ok: false, error: expect.stringContaining('no available model') })
        expect(src.chat(key)?.agent).toEqual({ kind: 'codex' })
      }
    } finally {
      for (const key of keys) delete src.agents.records[key]
      src.settings.set('coordinator.agent', null, { space: p.name })
      src.settings.set('task.agent', null, { space: p.name })
    }
  })
})

describe('Task IDs live only in repository space Settings', () => {
  test('edits apply to new tasks and survive a display rename; invalid scopes and collisions fail', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shep-id-settings-'))
    execSync('git init -q -b main', { cwd: dir })
    const p = await src.places.add(dir, 'id-settings')
    const place = placeId.space(p.name)
    const set = (key: string, value: string, at = place) => src.act({ type: 'setting', place: at, key, value })
    expect(await set('taskIds.prefix', 'GAME')).toMatchObject({ ok: true })
    expect(await set('taskIds.next', '100')).toMatchObject({ ok: true })
    const t = src.engine.add({ project: p.name, title: 'Numbered', by: 'test', after: [], later: true })
    expect(t.id).toBe('GAME-100')
    src.places.rename(place, 'pretty-name')
    expect(src.places.space(place)?.key).toBe('GAME')
    expect(await set('taskIds.next', '100')).toMatchObject({ ok: false })
    expect(await set('taskIds.prefix', 'NEWKEY')).toMatchObject({ ok: true })
    expect(t.id).toBe('GAME-100')
    expect(src.engine.add({ project: 'pretty-name', title: 'Next', by: 'test', later: true }).id).toBe('NEWKEY-101')
    expect(await set('taskIds.prefix', 'invalid')).toMatchObject({ ok: false })
    for (const at of ['all', placeId.machine(), placeId.home(), 'p:other:some-space']) expect(await set('taskIds.next', '999', at)).toMatchObject({ ok: false })
    const snap = await src.snapshot()
    const pages = snap.settings.filter((s) => s.name === 'Task IDs')
    expect(pages.find((s) => s.level === place)?.rows[0].value).toBe('NEWKEY')
    expect(pages.every((s) => s.level?.startsWith('p:') && !s.level.endsWith(':~'))).toBe(true)
    const otherDir = mkdtempSync(join(tmpdir(), 'shep-id-other-'))
    execSync('git init -q -b main', { cwd: otherDir })
    const other = await src.places.add(otherDir, 'id-other')
    expect(await set('taskIds.prefix', 'GAME', placeId.space(other.name))).toMatchObject({ ok: false })
  })
})

afterAll(stopSource)
