import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LINECLEAR_HOME = mkdtempSync(join(tmpdir(), 'shep-private-launch-'))
process.env.HERDR_SOCKET_PATH = join(process.env.LINECLEAR_HOME, 'no-herdr.sock')
const { Agents } = await import('../server/live/agents.ts')

describe('private launch prompt delivery', () => {
  test('pi appends a private prompt file outside the repository, on a start', () => {
    const a = new Agents()
    try {
      const r = {
        key: 'PRIVATE-2/Agent',
        name: 'private-test-pi',
        kind: 'pi',
        cwd: '/unused-repo',
        workspace: 'test',
        logs: [],
        started: 0,
        sessionId: 'old-session',
        system: 'Synthetic personal rule.',
      }
      const args = a.args(r)
      const path = args[args.indexOf('--append-system-prompt') + 1]
      expect(path).not.toStartWith(r.cwd)
      expect(readFileSync(path, 'utf8')).toBe(r.system)
    } finally {
      a.stop()
    }
  })
})
