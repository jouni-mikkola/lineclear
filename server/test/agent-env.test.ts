import { expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentEnv } from '../server/live/box.ts'

test("an agent's PATH resolves lineclear to builds/current, whatever repo its worktree is", () => {
  const data = mkdtempSync(join(tmpdir(), 'lc-agent-env-'))
  const bin = join(data, 'builds', 'current', 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'lineclear'), '#!/bin/sh\n')
  chmodSync(join(bin, 'lineclear'), 0o755)
  const path = agentEnv('LINE-1/Agent', '/root', data).PATH.split(':')
  expect(path).toContain(bin)
  expect(path.indexOf(bin)).toBeLessThan(path.indexOf(process.env.PATH?.split(':')[0] ?? ''))
  expect(Bun.which('lineclear', { PATH: path.join(':') })?.startsWith(bin) ?? false).toBe(true)
})

test('no stable build, no stable bin on PATH', () => {
  const data = mkdtempSync(join(tmpdir(), 'lc-agent-env-'))
  expect(agentEnv('LINE-1/Agent', '/root', data).PATH).not.toContain(data)
})
