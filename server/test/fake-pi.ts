// A fake pi RPC agent for the core loop's test: the engine's view of agents (ensure, send, status) with the agent's
// own work done by hand (work, review). It outlives an engine, as a pi child does a server; the engine of a killed
// run hears nothing more from it, and what that engine asked for never finishes.
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sh = (cmd: string, cwd: string) => execSync(cmd, { cwd, shell: '/bin/sh', encoding: 'utf8' }).trim()

type Start = { key: string; cwd: string; first?: string }

export function fakePi() {
  /** every start an engine asked for, in order: a key twice is a second agent for one task */
  const starts: Start[] = []
  const told: { key: string; text: string }[] = []
  const reviews: string[] = []
  const status: Record<string, string> = {}
  const cwds: Record<string, string> = {}
  let run = 0

  const agents = {
    routed: () => false,
    ensure: async (s: Start) => {
      starts.push({ key: s.key, cwd: s.cwd, first: s.first })
      cwds[s.key] = s.cwd
      status[s.key] = 'working'
      return null
    },
    send: async (key: string, text: string) => {
      told.push({ key, text })
      status[key] = 'working'
      return { waiting: false, item: {} }
    },
    on: () => () => undefined,
    status: (key: string) => status[key] ?? 'gone',
    aborted: () => false,
    record: () => undefined,
    herdrView: () => undefined,
    info: () => undefined,
    waiting: () => [],
    finish: async (key: string) => void (status[key] = 'gone'),
    interrupt: async () => undefined,
    stopTurn: async () => undefined,
    restart: async (s: Start) => agents.ensure(s),
    forget: () => undefined,
  }
  const chats = {
    post: () => undefined,
    lastReply: () => undefined,
    openQuestion: () => undefined,
    openCard: () => undefined,
    openCardTitle: () => undefined,
    unseen: () => [],
    menu: () => undefined,
    forget: () => undefined,
    chat: () => ({ messages: [] }),
  }

  /** the agents one engine sees: once a later one is made, every call of this one hangs, like a process that is gone */
  const forEngine = () => {
    const mine = ++run
    return new Proxy(agents, {
      get: (to, name: string) => {
        const f = to[name as keyof typeof to] as (...a: unknown[]) => unknown
        if (typeof f !== 'function') return f
        return (...a: unknown[]) => (mine === run ? f(...a) : new Promise(() => undefined))
      },
    })
  }

  return {
    starts,
    told,
    reviews,
    chats,
    forEngine,
    /** the agent works: its change is a file of its own, committed on its branch */
    work: (key: string, file: string) => {
      const dir = cwds[key]
      writeFileSync(join(dir, file), `${key}\n`)
      sh(`git add -A && git commit -qm "add ${file}"`, dir)
    },
    /** the reviewer, a model with no tools, passes the diff; the agent's turn ends */
    review: (key: string) => {
      reviews.push(key)
      status[key] = 'idle'
    },
    idle: (key: string) => void (status[key] = 'idle'),
  }
}
