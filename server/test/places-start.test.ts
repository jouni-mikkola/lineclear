// Places starts on a fresh store (it writes an empty spaces.json) and on one that has spaces.json (it keeps it).
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')

/** Places made as the server starts, on that folder of records: the spaces it holds */
function start(home: string): Array<{ name: string }> {
  const code = `const { Places } = await import(${JSON.stringify(join(root, 'server/live/places.ts'))}); console.log(JSON.stringify(new Places().spaces))`
  const r = spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8',
    env: { ...process.env, LINECLEAR_HOME: home, LINECLEAR_MACHINE: 'main', NODE_ENV: 'test' },
  })
  if (r.status !== 0) throw new Error(r.stderr)
  return JSON.parse(r.stdout)
}

describe('Places start', () => {
  test('a fresh store starts with no spaces and gets spaces.json', () => {
    const home = mkdtempSync(join(tmpdir(), 'places-new-'))
    expect(start(home)).toEqual([])
    expect(JSON.parse(readFileSync(join(home, 'spaces.json'), 'utf8'))).toEqual([])
  })

  test('a store that has spaces.json starts with its spaces', () => {
    const home = mkdtempSync(join(tmpdir(), 'places-old-'))
    const spaces = [{ name: 'web', path: '/x/web', key: 'WEB', base: 'main' }]
    writeFileSync(join(home, 'spaces.json'), JSON.stringify(spaces))
    expect(start(home)).toEqual(spaces)
    expect(JSON.parse(readFileSync(join(home, 'spaces.json'), 'utf8'))).toEqual(spaces)
  })
})
