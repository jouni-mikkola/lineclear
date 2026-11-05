// Two faults of Shepherdr 2.0 (docs/known-faults.md) that no other server test plants. Each fails on ebb17d5.
import { expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agents, hidden } from '../server/live/agents.ts'

test('machine news (load, quota, status) is never put into an agent', async () => {
  const a = new Agents()
  let put = 0
  ;(a as unknown as { put: () => Promise<void> }).put = async () => void put++
  a.status = () => 'idle'
  await a.send('demo', hidden('CPU load is 9.1', 'health', { kind: 'cpu' }))
  await a.send('LIN-9/Agent', hidden('LIN-9 is done', 'news', { task: 'LIN-9', event: 'merged' }))
  a.stop()
  expect(put).toBe(0)
})

test('a test run leaves no folder in the temp dir', () => {
  const outer = mkdtempSync(join(tmpdir(), 'old-faults-'))
  try {
    // a test of its own that makes a folder in the temp dir and never removes it
    const leaver = join(outer, 'leaver.test.ts')
    writeFileSync(
      leaver,
      "import { test } from 'bun:test'\nimport { mkdtempSync } from 'node:fs'\nimport { tmpdir } from 'node:os'\nimport { join } from 'node:path'\ntest('leaves a folder', () => void mkdtempSync(join(tmpdir(), 'leak-')))\n",
    )
    const r = Bun.spawnSync([process.execPath, 'test', leaver], {
      cwd: join(import.meta.dir, '..'),
      env: { ...process.env, TMPDIR: outer, LINECLEAR_TEST_RUNNER: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(r.exitCode).toBe(0)
    expect(readdirSync(outer).filter((n) => n.startsWith('leak-'))).toEqual([])
  } finally {
    rmSync(outer, { recursive: true, force: true })
  }
})
