// The tasks engine's test world, shared by the engine*.test.ts files: a real git repo, the agents stubbed, herdr a
// stand-in that makes and removes real git worktrees. Each file that imports it gets its own Lineclear home.
import { afterEach } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LINECLEAR_HOME = mkdtempSync(join(tmpdir(), 'shep-engine-'))
export const { Engine } = await import('../server/live/engine/engine.ts')
const { Places } = await import('../server/live/places.ts')
export const { placeId } = await import('../server/live/places.ts')
export const { Settings } = await import('../server/live/settings.ts')
export const { settingsBlock } = await import('../server/live/prompts.ts')
const store = await import('../server/store.ts')
const { COLD_FILE, COLD_AGENTS } = await import('../server/live/engine/cold.ts')
/** a test's tasks.json or agents.json is the whole of them: what earlier tests left in the cold logs goes */
export const writeJson = (name: string, value: unknown) => {
  if (name === 'tasks.json') rmSync(join(store.HOME, COLD_FILE), { force: true })
  if (name === 'agents.json') rmSync(join(store.HOME, COLD_AGENTS), { force: true })
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
      const pane = await s.pane?.()
      if (pane) {
        panes[s.key] = pane
        herdr.agentPanes.add(pane)
      }
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
    status: (key: string) => status[key] ?? 'gone',
    record: (key: string) => records[key],
    herdrView: () => undefined,
    info: (key: string) => (status[key] && status[key] !== 'gone' && panes[key] ? { pane_id: panes[key] } : undefined),
    waiting: (key: string) => outbox.filter((k) => k === key),
    finish: async (key: string) => {
      if (records[key]) records[key].finished = true
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
  const forgot: string[] = []
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
  const engine = new Engine(agents as never, chats as never, places, settings, herdr.h as never)
  engines.push(engine)
  const news: string[] = []
  /** the place each news is for: a project's place id, as its coordinator's chat has it */
  const newsTo: string[] = []
  engine.on('news', (p, text) => (newsTo.push(p), news.push(text)))
  const cards: { task: string; status: string; sub: string }[] = []
  engine.on('card', (t, status, sub) => cards.push({ task: t.id, status, sub }))
  /** herdr says the agent's state changed */
  const agentIs = (key: string, st: string) => {
    status[key] = st
    engine.agentStatus(key)
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
