// The tasks engine's test world, shared by the engine*.test.ts files: a real git repo, the agents stubbed, herdr a
// stand-in that makes and removes real git worktrees. Each file that imports it gets its own Lineclear home.
import { afterEach } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LINECLEAR_HOME = mkdtempSync(join(tmpdir(), 'shep-engine-'))
const { Engine } = await import('../server/live/engine/engine.ts')
const { Places } = await import('../server/live/places.ts')
export const { placeId } = await import('../server/live/places.ts')
export const { Settings } = await import('../server/live/settings.ts')
export const { settingsBlock } = await import('../server/live/settings-block.ts')
const store = await import('../server/store.ts')
/** a test's tasks.json or agents.json is the whole of them: the rows earlier tests left go, and the file is imported again */
export const writeJson = (name: string, value: unknown) => {
  if (name === 'tasks.json') {
    for (const table of ['tasks', 'task_briefs', 'task_meta', 'imports']) {
      try {
        store.db.exec(table === 'imports' ? "delete from imports where name = 'tasks.json'" : `delete from ${table}`)
      } catch {
        // no engine has made the table yet
      }
    }
  }
  if (name === 'agents.json') {
    store.db.exec(
      "create table if not exists agents (key text primary key, json text not null); create table if not exists imports (name text primary key); delete from agents; delete from imports where name = 'agents.json'",
    )
  }
  store.writeJson(name, value)
}
export const { fakeHerdr } = await import('./fake-herdr.ts')

// each engine's timers stop with its test: a sweep an earlier test's engine starts 20 s on (sooner than its test ends
// on a busy machine) would go through the files this test's engine uses
const engines: InstanceType<typeof Engine>[] = []
afterEach(() => {
  for (const e of engines.splice(0)) e.stop()
})

export const sh = (cmd: string, cwd: string) => execSync(cmd, { cwd, shell: '/bin/sh', encoding: 'utf8' }).trim()

export function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'shep-repo-'))
  sh('git init -q -b main && git config user.email t@t && git config user.name T && echo hi > README.md && git add -A && git commit -qm init', dir)
  return dir
}

/** boot: what herdr says once the agent is ready; any but working leaves its brief waiting to go in */
export function world(herdr = fakeHerdr(), o: { boot?: string } = {}) {
  const started: { key: string; first?: string; cwd: string; system?: string; pane?: string }[] = []
  const status: Record<string, string> = {}
  const sent: { key: string; text: string }[] = []
  const records: Record<string, { kind: string; started: number; finished?: boolean }> = {}
  const panes: Record<string, string> = {}
  const outbox: string[] = []
  const routed: Record<string, boolean> = {}
  const agents = {
    routed: (key: string) => routed[key] ?? false,
    ensure: async (s: { key: string; first?: string; cwd: string; kind: string; pane?: () => Promise<string> }) => {
      // herdr gives an agent a pane of its own; the engine does not ask for one
      const pane = `${s.key}:pane`
      panes[s.key] = pane
      herdr.agentPanes.add(pane)
      started.push({ ...s, pane })
      records[s.key] = { kind: s.kind, started: Date.now() }
      status[s.key] = o.boot ?? 'working'
      if (o.boot) outbox.push(s.key)
      return null
    },
    send: async (key: string, text: string) => {
      sent.push({ key, text })
      return { waiting: false, item: {} }
    },
    on: (event: string, f: (k: string) => void) => {
      const set = (listeners[event] ??= new Set())
      set.add(f)
      return () => void set.delete(f)
    },
    status: (key: string) => status[key] ?? 'gone',
    aborted: (key: string) => abortedKeys.has(key),
    record: (key: string) => records[key],
    herdrView: () => undefined,
    info: (key: string) => (status[key] && status[key] !== 'gone' && panes[key] ? { pane_id: panes[key] } : undefined),
    waiting: (key: string) => outbox.filter((k) => k === key),
    finish: async (key: string) => {
      if (records[key]) records[key].finished = true
      finishedKeys.push(key)
      status[key] = 'gone'
      if (panes[key]) await herdr.h.closePane(panes[key])
    },
    interrupt: async () => undefined,
    stopTurn: async (key: string) => void (status[key] === 'working' && stopped.push(key)),
    restart: async (
      s: { key: string; first?: string; cwd: string; kind: string; pane?: () => Promise<string> },
      before?: () => Promise<string | undefined>,
    ) => {
      const first = await before?.()
      await agents.finish(s.key)
      return agents.ensure({ ...s, ...(first ? { first } : {}) })
    },
    forget: (key: string) => {
      delete records[key]
      forgot.push(key)
    },
  }
  const listeners: Record<string, Set<(k: string) => void>> = {}
  const forgot: string[] = []
  /** every agent finish() was called for, kept after forget drops its record */
  const finishedKeys: string[] = []
  const abortedKeys = new Set<string>()
  /** agents whose turn was interrupted before a restart */
  const stopped: string[] = []
  const posted: { key: string; id: string; question?: { kind: string; steps?: string[] }; card?: { text: string; restart?: boolean } }[] = []
  /** what the agent's chat holds: its last reply, an open card of Lineclear's, its CLI's own question */
  const chat: {
    reply?: string
    card?: 'plan' | 'ask'
    cardTitle?: string
    question?: boolean
    unseen?: string[]
    messages?: { who: string; text?: string; card?: object }[]
  } = { reply: 'Which name do you want?' }
  const chats = {
    post: (key: string, p: { id: string; question?: { kind: string } }) => posted.push({ key, ...p }),
    lastReply: () => chat.reply,
    openQuestion: () => (chat.question ? { id: 'q', items: [{ question: 'Which one?', options: [], multiSelect: false }] } : undefined),
    openCard: () => chat.card,
    openCardTitle: () => (chat.card ? chat.cardTitle : undefined),
    unseen: () => chat.unseen ?? [],
    menu: (key: string) => (status[key] === 'blocked' ? { title: 'Allow: rm -rf build' } : undefined),
    forget: (key: string) => forgot.push(`chat ${key}`),
    chat: () => ({ messages: chat.messages ?? [] }),
  }
  const places = new Places()
  const settings = new Settings()
  // the default is the machine's cores minus 2: a 4-core runner would queue the third task of a test
  settings.set('machine.maxTasks', '50')
  const engine = new Engine(agents as never, chats as never, places, settings)
  engines.push(engine)
  const news: string[] = []
  /** the place each news is for: a project's place id, as its coordinator's chat has it */
  const newsTo: string[] = []
  engine.on('news', (p, text) => (newsTo.push(p), news.push(text)))
  const cards: { task: string; status: string; sub: string }[] = []
  engine.on('card', (t, status, sub) => cards.push({ task: t.id, status, sub }))
  /** herdr says the agent's state changed */
  const agentIs = (key: string, st: string, aborted = false) => {
    status[key] = st
    if (aborted) abortedKeys.add(key)
    else abortedKeys.delete(key)
    engine.agentStatus(key)
    for (const f of listeners.status ?? []) f(key)
  }
  /** what waits to go in to it goes in */
  const brief = (key: string) => {
    outbox.splice(0, outbox.length, ...outbox.filter((k) => k !== key))
    engine.sent(key)
  }
  return {
    routed,
    agents,
    engine,
    places,
    settings,
    started,
    sent,
    posted,
    status,
    records,
    news,
    newsTo,
    cards,
    agentIs,
    brief,
    herdr,
    chat,
    forgot,
    finishedKeys,
    stopped,
  }
}

import { until } from './until.ts'
export { until }

/** a task whose agent has started in its worktree */
export async function started(w: ReturnType<typeof world>, dir: string, name: string, title = 'Say hello', desc = 'Add hello.txt. Merge when done.') {
  const p = await w.places.add(dir, name)
  const t = w.engine.add({ project: p.name, title, desc, by: 'test' })
  await until(() => w.started.some((s) => s.key === `${t.id}/Agent`))
  return { p, t, key: `${t.id}/Agent` }
}
