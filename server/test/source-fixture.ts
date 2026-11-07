import { expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LINECLEAR_HOME = mkdtempSync(join(tmpdir(), 'shep-source-'))
// no agent CLI is there either: an agent's start fails at once instead of running a real one
process.env.LINECLEAR_PI = '/nonexistent/pi'
process.env.HERDR_SOCKET_PATH = join(process.env.LINECLEAR_HOME, 'no-herdr.sock')
delete process.env.LINECLEAR_MAIN
const { LiveSource } = await import('../server/live/source.ts')
export const { HOST, NAME, placeId, Places } = await import('../server/live/places.ts')
export const { herdr } = await import('../server/live/herdr.ts')
export const { hidden } = await import('../server/live/agents.ts')
const { isAgentProcess } = await import('../server/live/agent-process.ts')

export const src = new LiveSource()
// no herdr is there: the terminal an agent would start in is refused at once, so no start waits on a socket
herdr.workspaces = async () => {
  throw new Error('herdr is not here')
}
// --rerun-each runs the file's afterAll after every run, and the next run still needs the source: it ends with the process then
export const stopSource = () => process.env.LINECLEAR_TEST_RERUN || src.stop()

import { until } from './until.ts'
export { until }

/** a project with a task whose agent has committed work on its branch (herdr isn't there: its agent can't start) */
export async function workedTask(name: string) {
  const dir = mkdtempSync(join(tmpdir(), 'shep-src-repo-'))
  execSync('git init -q -b main && git config user.email t@t && git config user.name T && echo hi > README.md && git add -A && git commit -qm init', {
    cwd: dir,
    shell: '/bin/sh',
  })
  // a rerun of the same test (--rerun-each) finds its first run's space still there
  let unique = name
  for (let n = 2; src.places.nameProblem(unique); n++) unique = `${name}-${n}`
  const p = await src.places.add(dir, unique)
  // no herdr is there, so a sampled machine reads as not ready and would hold the new task; and the slots follow the
  // machine's cores, so the tasks of earlier tests would hold it on a small one
  const machine = src.engine.machine
  const room = src.engine.room
  src.engine.machine = () => undefined
  src.engine.room = () => ({})
  const t = src.engine.add({ project: p.name, title: 'Worked', by: 'test' })
  src.engine.machine = machine
  src.engine.room = room
  // the worktree is there before the agent's start is over, and a delete in that time is refused as busy
  await until(() => !!t.worktree && t.phase !== 'starting').catch(() => undefined)
  // never in the folder the tests run from
  if (!t.worktree) throw new Error(`${t.id} got no worktree: ${t.trouble}`)
  execSync('echo x > x.txt && git add -A && git commit -qm work', { cwd: t.worktree!, shell: '/bin/sh' })
  return { t, dir, place: placeId.space(p.name) }
}

test('native and npm agent CLI process identities', () => {
  expect(isAgentProcess('codex', ['/opt/bin/codex', '--resume'])).toBe(true)
  expect(isAgentProcess('pi', ['/usr/bin/node', '/opt/node_modules/@mariozechner/pi-coding-agent/dist/cli.js'])).toBe(true)
  expect(isAgentProcess('claude', ['/usr/bin/node', '/opt/node_modules/@anthropic-ai/claude-code/cli.js'])).toBe(true)
  expect(isAgentProcess('pi', ['/usr/bin/node', '/some/app.js', 'pi'])).toBe(false)
})
