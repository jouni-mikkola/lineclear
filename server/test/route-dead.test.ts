import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('1000 dead routes run no ps, and are deleted', () => {
  if (!existsSync('/proc/self')) return
  const home = mkdtempSync(join(tmpdir(), 'lc-route-'))
  const routes = join(home, '.lineclear/helper/routes')
  mkdirSync(routes, { recursive: true, mode: 0o700 })
  mkdirSync(join(home, 'bin'))
  writeFileSync(join(home, 'bin', 'ps'), `#!/bin/sh\necho x >> ${join(home, 'ps-calls')}\n`)
  chmodSync(join(home, 'bin', 'ps'), 0o755)
  for (let i = 0; i < 1000; i++) writeFileSync(join(routes, `${4_000_000 + i}.json`), JSON.stringify({ chat: 'a', cwd: '/x', stamp: '1' }))
  const perl = `require "${join(import.meta.dir, '../helper/route.pl')}"; session_route(); bind_route($$, '{"chat":"a","cwd":"/tmp"}');`
  const r = Bun.spawnSync(['perl', '-e', perl], {
    env: { ...process.env, HOME: home, LINECLEAR_CHAT: 'a', PATH: `${join(home, 'bin')}:${process.env.PATH}` },
    cwd: '/tmp',
    stderr: 'pipe',
  })
  expect(r.stderr.toString()).toBe('')
  expect(existsSync(join(home, 'ps-calls'))).toBe(false)
  expect(readdirSync(routes).filter((n) => /^4000\d{3}\.json$/.test(n))).toEqual([])
})
