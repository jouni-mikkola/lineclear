// Two processes set a value at the same moment: both stay, as each is its own row in the store.
import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')

test('two processes setting different keys at once both see both', async () => {
  const home = mkdtempSync(join(tmpdir(), 'settings-two-'))
  const run = (key: string, value: string) =>
    Bun.spawn(
      [
        process.execPath,
        '-e',
        `const { Settings } = await import(${JSON.stringify(join(root, 'server/live/settings.ts'))})
         const s = new Settings()
         for (let i = 0; i < 20; i++) { s.set(${JSON.stringify(key)}, i % 2 ? ${JSON.stringify(value)} : 'on'); s.set('machine.maxTasks', String(i + 1), 'machine') }
         s.set(${JSON.stringify(key)}, ${JSON.stringify(value)})`,
      ],
      { env: { ...process.env, LINECLEAR_HOME: home, NODE_ENV: 'test' }, stdout: 'ignore', stderr: 'pipe' },
    )
  const [a, b] = [run('brief.review', 'off'), run('brief.merge', 'ask me first')]
  expect(await a.exited).toBe(0)
  expect(await b.exited).toBe(0)
  const check = Bun.spawnSync(
    [
      process.execPath,
      '-e',
      `const { Settings } = await import(${JSON.stringify(join(root, 'server/live/settings.ts'))})
       const s = new Settings(); console.log(JSON.stringify(s.everywhere()))`,
    ],
    { env: { ...process.env, LINECLEAR_HOME: home, NODE_ENV: 'test' } },
  )
  expect(JSON.parse(check.stdout.toString())).toEqual({ 'brief.review': 'off', 'brief.merge': 'ask me first' })
})
