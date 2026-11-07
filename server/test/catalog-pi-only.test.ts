import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { CATALOG, CLIS } from '../server/live/settings-catalog.ts'
import { parseArgs } from '../server/live/args.ts'
import { harnessOf } from '../server/live/source-helpers.ts'
import { Settings } from '../server/live/settings.ts'

const settings = new Settings({ everywhere: {}, machine: {}, spaces: {} })

test('the catalog names pi alone and stays small', () => {
  expect(CLIS).toEqual(['pi'])
  const agentOptions = CATALOG.flatMap((s) => s.rows)
    .filter((r) => r.key.endsWith('.agent') || r.key === 'task.fallback')
    .flatMap((r) => r.options ?? [])
  expect(new Set(agentOptions.filter((o) => o !== 'off'))).toEqual(new Set(['pi']))
  expect(readFileSync(new URL('../server/live/settings-catalog.ts', import.meta.url), 'utf8').split('\n').length).toBeLessThan(120)
})

test('task add --agent claude is refused with a line that names pi', () => {
  expect(() => harnessOf(parseArgs(['--agent', 'claude']), settings)).toThrow(/No CLI called claude; herdr starts pi/)
  expect(harnessOf(parseArgs(['--agent', 'pi']), settings).kind).toBe('pi')
})
