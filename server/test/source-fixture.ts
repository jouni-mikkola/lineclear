import { expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LINECLEAR_HOME = mkdtempSync(join(tmpdir(), 'shep-source-'))
process.env.HERDR_SOCKET_PATH = join(process.env.LINECLEAR_HOME, 'no-herdr.sock')
delete process.env.LINECLEAR_MAIN
const { LiveSource } = await import('../server/live/source.ts')
export const { HOST, NAME, placeId, Places } = await import('../server/live/places.ts')
export const { herdr } = await import('../server/live/herdr.ts')
export const { hidden } = await import('../server/live/agents.ts')
const { isAgentProcess } = await import('../server/live/agent-process.ts')
export const { heartbeatFile } = await import('../server/live/heartbeat.ts')
export const { carryOn } = await import('../server/live/retry.ts')
const { Worktrees } = await import('../server/live/engine/worktrees.ts')
const { fakeHerdr } = await import('./fake-herdr.ts')

export const src = new LiveSource()
// herdr makes task worktrees: a stand-in on real git; no terminal opens for their agents (no herdr is there)
const fake = fakeHerdr()
fake.h.createTab = async () => {
  throw new Error('herdr is not here')
}
Object.assign(src.engine, { wt: new Worktrees(fake.h as never) })
export const stopSource = () => src.stop()

/** what a test waits for has come true, however slow the machine (a timer, another process) */
export const until = async (f: () => boolean, ms = 60_000) => {
  for (const t0 = Date.now(); !f(); await Bun.sleep(20)) if (Date.now() - t0 > ms) throw new Error('timed out')
}

/** a project with a task whose agent has committed work on its branch (herdr isn't there: its agent can't start) */
export async function workedTask(name: string) {
  const dir = mkdtempSync(join(tmpdir(), 'shep-src-repo-'))
  execSync('git init -q -b main && git config user.email t@t && git config user.name T && echo hi > README.md && git add -A && git commit -qm init', {
    cwd: dir,
    shell: '/bin/sh',
  })
  const p = await src.places.add(dir, name)
  const t = src.engine.add({ project: p.name, title: 'Worked', by: 'test' })
  await until(() => !!t.worktree).catch(() => undefined)
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
