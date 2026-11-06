// The contract between Lineclear and the herdr installed on this machine. Every call of the adapter (herdr.ts) is
// checked against the API schema that herdr prints, and a herdr of its own (its own config folder and socket, apart
// from the one that runs your agents) answers the calls Lineclear's work depends on. An update of herdr is a step:
// this test green against it, then HERDR_TESTED raised. Without herdr on the machine it says so and skips.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HERDR_TESTED, herdr, herdrCliSync, paneEvents, rpc, Subscription, type HerdrEvent } from '../server/live/herdr.ts'
import { forwardArgs, herdrOn, room } from '../server/live/herdr-forward.ts'
import { until } from './until.ts'

const bin = Bun.which('herdr') ?? ''
if (!bin) console.info('herdr-contract: herdr is not installed here, so its contract is not checked')

type Schema = Record<string, unknown>
const schemaDoc: Schema = bin ? JSON.parse(Bun.spawnSync([bin, 'api', 'schema', '--json']).stdout.toString()) : {}

const resolve = (s: Schema): Schema => {
  const ref = s.$ref as string | undefined
  if (!ref) return s
  return ref
    .slice(2)
    .split('/')
    .reduce<Schema>((at, k) => at[k] as Schema, schemaDoc)
}

const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v)

/** what in `value` the schema refuses, by path; empty when it fits. Unknown keys are refused: herdr would ignore them */
function misfits(value: unknown, raw: Schema, at: string): string[] {
  const s = resolve(raw)
  const alternatives = (s.oneOf ?? s.anyOf) as Schema[] | undefined
  if (alternatives) {
    const each = alternatives.map((a) => misfits(value, a, at))
    return each.some((m) => !m.length) ? [] : (each.sort((a, b) => a.length - b.length)[0] ?? [`${at}: no alternative fits`])
  }
  if ('const' in s && value !== s.const) return [`${at}: is ${JSON.stringify(value)}, herdr wants ${JSON.stringify(s.const)}`]
  if (Array.isArray(s.enum) && !s.enum.includes(value)) return [`${at}: ${JSON.stringify(value)} is not one of ${s.enum.join(', ')}`]
  const types = s.type === undefined ? [] : ([] as string[]).concat(s.type as string)
  const t = typeOf(value)
  if (types.length && !types.includes(t) && !(t === 'integer' && types.includes('number'))) return [`${at}: is ${t}, herdr wants ${types.join(' or ')}`]
  if (t === 'array' && s.items) return (value as unknown[]).flatMap((v, i) => misfits(v, s.items as Schema, `${at}[${i}]`))
  if (t !== 'object') return []
  const obj = value as Record<string, unknown>
  const props = (s.properties ?? {}) as Record<string, Schema>
  const extra = s.additionalProperties as Schema | undefined
  const out = ((s.required ?? []) as string[]).filter((k) => !(k in obj)).map((k) => `${at}.${k}: missing`)
  for (const [k, v] of Object.entries(obj)) {
    if (props[k]) out.push(...misfits(v, props[k], `${at}.${k}`))
    else if (extra && typeof extra === 'object') out.push(...misfits(v, extra, `${at}.${k}`))
    else out.push(`${at}.${k}: herdr has no such parameter`)
  }
  return out
}

/** what herdr refuses in one request, by its schema */
function refused(req: { method: string; params: unknown }): string[] {
  const request = (schemaDoc.schemas as Record<string, Schema>).request
  const call = (request.oneOf as Schema[]).find((o) => ((o.properties as Record<string, Schema>).method as Schema).const === req.method)
  if (!call) return [`${req.method}: herdr has no such call`]
  return misfits(req.params, (call.properties as Record<string, Schema>).params, req.method)
}

/** one call of every adapter function, with the arguments Lineclear passes: a new one without a line here fails types */
const everyCall: Record<keyof typeof herdr, () => Promise<unknown>> = {
  ping: () => herdr.ping(),
  agents: () => herdr.agents(),
  snapshot: () => herdr.snapshot(),
  agent: () => herdr.agent('shep-lin-1'),
  workspaces: () => herdr.workspaces(),
  createWorkspace: () => herdr.createWorkspace('lineclear', '/tmp', { LINECLEAR_CHAT: 'LIN-1/Agent' }),
  renameWorkspace: () => herdr.renameWorkspace('w1', 'lineclear'),
  createTab: () => herdr.createTab('w1', 'review', '/tmp', { A: 'b' }),
  start: () => herdr.start('shep-lin-1', 'pi', 'w1:p1', ['--model', 'm']),
  rename: () => herdr.rename('w1:p1', 'shep-lin-1'),
  prompt: () => herdr.prompt('shep-lin-1', 'Go'),
  sendKeys: () => herdr.sendKeys('shep-lin-1', ['Enter']),
  paneKeys: () => herdr.paneKeys('w1:p1', ['Enter']),
  paneText: () => herdr.paneText('w1:p1', 'bun run check'),
  read: () => herdr.read('w1:p1', 'ansi', 300),
  visible: () => herdr.visible('w1:p1'),
  size: () => herdr.size('w1:p1'),
  panes: () => herdr.panes('w1'),
  tabs: () => herdr.tabs('w1'),
  processInfo: () => herdr.processInfo('w1:p1'),
  paneIdle: () => herdr.paneIdle('w1:p1'),
  worktreeCreate: () => herdr.worktreeCreate({ cwd: '/tmp/repo' }, 'work/1-x', 'main', 'LIN-1', '/tmp/repo-1'),
  worktreeOpen: () => herdr.worktreeOpen({ workspace_id: 'w1' }, '/tmp/repo-1', 'LIN-1'),
  worktreeRemove: () => herdr.worktreeRemove('w2'),
  closePane: () => herdr.closePane('w1:p1'),
  closeWorkspace: () => herdr.closeWorkspace('w1'),
  notify: () => herdr.notify('Lineclear', 'merged'),
}

describe.skipIf(!bin)('herdr contract: the schema', () => {
  let sent: { method: string; params: unknown }[] = []
  let fake: ReturnType<typeof Bun.listen> | undefined
  const dir = mkdtempSync(join(tmpdir(), 'herdr-contract-'))
  const sock = join(dir, 'fake.sock')
  // the answer shape every adapter function can read without throwing
  const result = {
    agents: [],
    snapshot: { agents: [] },
    agent: {},
    workspaces: [],
    panes: [],
    tabs: [],
    process_info: {},
    layout: { panes: [] },
    read: { text: '' },
  }

  beforeAll(() => {
    fake = Bun.listen({
      unix: sock,
      socket: {
        data(s, d) {
          for (const line of d.toString().split('\n').filter(Boolean)) {
            const r = JSON.parse(line)
            sent.push({ method: r.method, params: r.params })
            s.write(`${JSON.stringify({ id: r.id, result })}\n`)
          }
        },
      },
    })
  })
  afterAll(() => {
    fake?.stop(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('the installed herdr is the one Lineclear is tested with', () => {
    const version = Bun.spawnSync([bin, '--version'])
      .stdout.toString()
      .trim()
      .replace(/^herdr\s+/, '')
    expect(
      version,
      `herdr ${version} is installed, Lineclear is tested with ${HERDR_TESTED.version}: run this test with it, then raise HERDR_TESTED in server/live/herdr.ts`,
    ).toBe(HERDR_TESTED.version)
    expect(schemaDoc.protocol).toBe(HERDR_TESTED.protocol)
  })

  test('every call of the adapter fits the schema', async () => {
    const was = process.env.HERDR_SOCKET_PATH
    process.env.HERDR_SOCKET_PATH = sock
    const out: string[] = []
    try {
      for (const [name, call] of Object.entries(everyCall)) {
        sent = []
        await call()
        expect(sent.length, `${name} sent nothing`).toBe(1)
        out.push(...refused(sent[0]).map((m) => `${name}: ${m}`))
        // the same call on a machine saved in herdr is the same call as a command with the machine named
        if (sent[0].method !== 'ping' && sent[0].method !== 'session.snapshot') {
          const args = forwardArgs(sent[0].method, sent[0].params as Record<string, unknown>)
          if (!args) out.push(`${name}: ${sent[0].method} has no herdr command for the forwarding`)
          else {
            const help = herdrCliSync([...args.slice(0, 2), '--help'])
            expect(help?.out, `${name}: herdr has no command ${args.slice(0, 2).join(' ')}`).toContain('Usage: herdr')
          }
          if (name === 'worktreeRemove') expect(args).toEqual(['worktree', 'remove', '--workspace', 'w2'])
        }
      }
      sent = []
      let opened: () => void = () => undefined
      const ready = new Promise<void>((resolve) => {
        opened = resolve
      })
      const sub = new Subscription(
        () => undefined,
        () => opened(),
      )
      try {
        sub.set(paneEvents(['w1:p1', 'w2:p1']))
        await ready
        expect(sent.length).toBe(1)
        out.push(...refused(sent[0]))
      } finally {
        sub.stop()
      }
    } finally {
      if (was === undefined) delete process.env.HERDR_SOCKET_PATH
      else process.env.HERDR_SOCKET_PATH = was
    }
    expect(out).toEqual([])
  })

  test('a planted unknown call, parameter or event is refused', () => {
    expect(refused({ method: 'pane.run_command', params: {} })).toEqual(['pane.run_command: herdr has no such call'])
    expect(refused({ method: 'pane.read', params: { pane_id: 'w1:p1', source: 'recent', colour: true } })).toEqual([
      'pane.read.colour: herdr has no such parameter',
    ])
    expect(refused({ method: 'pane.read', params: { pane_id: 'w1:p1' } })).toEqual(['pane.read.source: missing'])
    expect(refused({ method: 'events.subscribe', params: { subscriptions: [{ type: 'pane.output_changed', pane_id: 'w1:p1' }] } }).length).toBeGreaterThan(0)
  })
})

describe.skipIf(!bin)('herdr contract: a herdr of its own', () => {
  const dir = mkdtempSync(join(tmpdir(), 'herdr-contract-live-'))
  const sock = join(dir, 'config', 'herdr', 'herdr.sock')
  const repo = join(dir, 'repo')
  let server: ReturnType<typeof Bun.spawn> | undefined
  let was: string | undefined
  // its own config, state and data folders: nothing of the herdr that runs your agents is read or touched
  const env: Record<string, string> = {
    HOME: process.env.HOME ?? dir,
    PATH: process.env.PATH ?? '',
    SHELL: '/bin/sh',
    XDG_CONFIG_HOME: join(dir, 'config'),
    XDG_STATE_HOME: join(dir, 'state'),
    XDG_DATA_HOME: join(dir, 'data'),
  }

  beforeAll(async () => {
    const git = (...a: string[]) =>
      Bun.spawnSync(['git', '-C', repo, ...a], {
        env: { ...env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
      })
    Bun.spawnSync(['git', 'init', '-q', '-b', 'main', repo])
    git('commit', '-q', '--allow-empty', '-m', 'first')
    server = Bun.spawn([bin, 'server'], { env, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
    was = process.env.HERDR_SOCKET_PATH
    process.env.HERDR_SOCKET_PATH = sock
    for (let i = 0; i < 100; i++) {
      if (
        await herdr.ping().then(
          () => true,
          () => false,
        )
      )
        return
      await Bun.sleep(100)
    }
    throw new Error('the test herdr did not start')
  }, 15_000)

  afterAll(async () => {
    await rpc('server.stop', {}, 3000).catch(() => undefined)
    server?.kill()
    await server?.exited
    if (was === undefined) delete process.env.HERDR_SOCKET_PATH
    else process.env.HERDR_SOCKET_PATH = was
    rmSync(dir, { recursive: true, force: true })
  })

  test('it answers ping with the version and protocol Lineclear is tested with', async () => {
    expect(await herdr.ping()).toMatchObject(HERDR_TESTED)
  })

  test('a workspace runs a command typed into its pane, read back, and its events arrive', async () => {
    const events: HerdrEvent[] = []
    let opened = false
    const sub = new Subscription(
      (e) => events.push(e),
      () => {
        opened = true
      },
    )
    sub.set(paneEvents([]))
    try {
      await until(() => opened, 'the workspace to open')
      expect(opened).toBe(true)
      const w = await herdr.createWorkspace('contract', dir, { LINECLEAR_CONTRACT: '1' })
      const pane = w.root_pane.pane_id
      expect((await herdr.workspaces()).map((x) => x.workspace_id)).toContain(w.workspace.workspace_id)
      expect((await herdr.panes(w.workspace.workspace_id)).map((p) => p.pane_id)).toContain(pane)
      await herdr.paneText(pane, 'echo "contract-$((40 + 2))-$LINECLEAR_CONTRACT"')
      await herdr.paneKeys(pane, ['Enter'])
      let text = ''
      await until(async () => {
        text = await herdr.read(pane, 'text', 50)
        return text.includes('contract-42-1')
      }, 'the pane to show contract-42-1')
      expect(text).toContain('contract-42-1')
      expect(await herdr.size(pane)).toMatchObject({ cols: expect.any(Number), rows: expect.any(Number) })
      await until(() => events.some((e) => e.event === 'pane_created'), 'a pane_created event')
      expect(events.map((e) => e.event)).toContain('pane_created')
      // the server's own list once an agent's pane is known: herdr takes it whole
      opened = false
      sub.set(paneEvents([pane]))
      await until(() => opened, 'the workspace to open')
      expect(opened).toBe(true)
      await herdr.closeWorkspace(w.workspace.workspace_id)
    } finally {
      sub.stop()
    }
  }, 20_000)

  test('a worktree is made on a new branch at a path of our choosing, and removed', async () => {
    const path = join(dir, 'repo-1')
    const made = await herdr.worktreeCreate({ cwd: repo }, 'work/1-contract', 'main', 'LIN-1', path)
    const branch = Bun.spawnSync(['git', '-C', path, 'branch', '--show-current']).stdout.toString().trim()
    expect(branch).toBe('work/1-contract')
    await herdr.worktreeRemove(made.workspace.workspace_id)
    expect(await Bun.file(join(path, '.git')).exists()).toBe(false)
  }, 30_000)
})

// the forwarding: every call again, on a machine saved in herdr (`herdr machine list`), reached by `herdr --machine`
const saved = bin
  ? (JSON.parse(herdrCliSync(['machine', 'list', '--json'])?.out || '[]') as { label: string; enabled: boolean }[]).find((m) => m.enabled)
  : undefined
if (bin && !saved) console.info('herdr-contract: no machine is saved in herdr here, so the forwarding is skipped')

describe.skipIf(!saved)('herdr contract: the forwarding to a saved machine', () => {
  const on = () => herdrOn(saved?.label)

  test('reads answer through --machine with the same shapes as here', async () => {
    const there = on()
    expect(Array.isArray(await there.agents())).toBe(true)
    const workspaces = await there.workspaces()
    expect(Array.isArray(workspaces)).toBe(true)
    const first = workspaces[0]?.workspace_id
    if (first) expect(Array.isArray(await there.panes(first))).toBe(true)
  }, 60_000)

  test('a tab runs a line there, is read back and closed, and the room is read from it', async () => {
    const there = on()
    const first = (await there.workspaces())[0]?.workspace_id
    expect(first, 'the saved machine has no workspace to open a tab in').toBeDefined()
    const tab = await there.createTab(first as string, 'contract', '/', {})
    try {
      await there.paneText(tab.root_pane.pane_id, 'echo forwarded-$((40 + 2))')
      await there.paneKeys(tab.root_pane.pane_id, ['Enter'])
      let text = ''
      await until(async () => {
        text = await there.read(tab.root_pane.pane_id, 'text', 50)
        return text.includes('forwarded-42')
      }, 'the pane to show forwarded-42')
      expect(text).toContain('forwarded-42')
    } finally {
      await there.closePane(tab.root_pane.pane_id).catch(() => undefined)
    }
    expect(await room(saved?.label)).toMatchObject({ load: expect.any(Number), cores: expect.any(Number), freeKb: expect.any(Number) })
  }, 120_000)
})
