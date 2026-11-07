import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseArgs } from '../server/live/args.ts'
import { harnessOf } from '../server/live/source-helpers.ts'
import { CLIS, KIND, Settings } from '../server/live/settings.ts'

test('the catalog names pi alone, in a small file, and task add --agent claude is refused naming pi', () => {
  expect(CLIS).toEqual(['pi'])
  expect(Object.keys(KIND)).toEqual(['pi'])
  const lines = readFileSync(new URL('../server/live/settings-catalog.ts', import.meta.url), 'utf8').split('\n').length
  expect(lines).toBeLessThan(120)
  const settings = new Settings({ everywhere: {}, machine: {}, spaces: {} })
  expect(() => harnessOf(parseArgs(['--agent', 'claude']), settings)).toThrow(/No CLI called claude; herdr starts pi/)
})
