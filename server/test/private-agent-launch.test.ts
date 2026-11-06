import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LINECLEAR_HOME = mkdtempSync(join(tmpdir(), 'shep-private-launch-'))
process.env.HERDR_SOCKET_PATH = join(process.env.LINECLEAR_HOME, 'no-herdr.sock')
const { Agents } = await import('../server/live/agents.ts')

describe('private launch prompt delivery', () => {
  test('Claude and pi append a private prompt file outside the repository, on fresh and resumed starts', () => {
    const a = new Agents()
    try {
      for (const kind of ['claude', 'pi'])
        for (const resume of [false, true]) {
          const r = {
            key: 'PRIVATE-2/Agent',
            name: `private-test-${kind}`,
            kind,
            cwd: '/unused-repo',
            workspace: 'test',
            logs: [],
            started: 0,
            sessionId: 'old-session',
            system: 'Synthetic personal rule.',
          }
          const args = a.args(r, resume)
          const flag = kind === 'claude' ? '--append-system-prompt-file' : '--append-system-prompt'
          const path = args[args.indexOf(flag) + 1]
          expect(path).not.toStartWith(r.cwd)
          expect(readFileSync(path, 'utf8')).toBe(r.system)
        }
    } finally {
      a.stop()
    }
  })
})
