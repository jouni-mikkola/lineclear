// A busy board for the loop: 400 tasks, 10 agents, UI clients on the live socket and a steady stream of changes.
// Used by loop-hot.test.ts (L307).
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LINECLEAR_HOME = mkdtempSync(join(tmpdir(), 'loop-board-'))
process.env.HERDR_SOCKET_PATH = join(process.env.LINECLEAR_HOME, 'no-herdr.sock')
delete process.env.LINECLEAR_MAIN
const { LiveSource } = await import('../server/live/source.ts')
const { startApp } = await import('../server/app.ts')
import type { TaskRec } from '../server/live/engine/engine.ts'
import type { AgentRecord } from '../server/live/agents-helpers.ts'

const BOARD = { tasks: 400, agents: 10, clients: 4 }

/** A server on a board of BOARD.tasks tasks, BOARD.agents of them with an agent at work, and BOARD.clients sockets open. */
export async function startBoard() {
  const src = new LiveSource()
  const repo = mkdtempSync(join(tmpdir(), 'loop-board-repo-'))
  execSync('git init -q -b main && git config user.email t@t && git config user.name T && echo hi > README.md && git add -A && git commit -qm init', {
    cwd: repo,
    shell: '/bin/sh',
  })
  const place = await src.places.add(repo, 'board')
  const now = Date.now()
  for (let n = 1; n <= BOARD.tasks; n++) {
    const live = n <= BOARD.agents
    const rec = {
      id: `B-${n}`,
      n,
      project: place.name,
      title: `Task ${n} with a title of a usual length`,
      result: 'A result sentence of the usual length for a task on the board.',
      desc: `Brief of task ${n}. `.repeat(60),
      by: 'test',
      created: now - n * 60_000,
      updated: now - n * 30_000,
      told: live ? 'work' : 'done',
      merged: !live,
      cleaned: !live,
      doneAt: live ? undefined : now - n * 30_000,
      worktree: live ? repo : undefined,
    } as TaskRec
    src.engine.tasks.push(rec)
    if (live)
      src.agents.records[`${rec.id}/Agent`] = {
        key: `${rec.id}/Agent`,
        name: `agent-${n}`,
        kind: 'pi',
        cwd: repo,
        workspace: 'board',
        logs: [],
        started: now,
      } as AgentRecord
  }
  const app = startApp({ source: src, port: 0 })
  const base = `http://127.0.0.1:${app.port}`
  const sockets = Array.from({ length: BOARD.clients }, () => new WebSocket(`${base.replace('http', 'ws')}/api/ws`))
  sockets.forEach((s) => s.addEventListener('message', () => undefined))
  await Promise.all(sockets.map((s) => new Promise((ok) => s.addEventListener('open', ok))))
  return {
    src,
    app,
    base,
    /** a change of the board every 100 ms, and a read of the snapshot every 250 ms, as busy screens do */
    churn() {
      const a = setInterval(() => src.emit('snapshot'), 100)
      const b = setInterval(
        () =>
          void fetch(`${base}/api/snapshot`).then(
            (r) => r.arrayBuffer(),
            () => undefined,
          ),
        250,
      )
      return () => (clearInterval(a), clearInterval(b))
    },
    stop() {
      sockets.forEach((s) => s.close())
      app.stop(true)
      src.stop()
    },
  }
}
