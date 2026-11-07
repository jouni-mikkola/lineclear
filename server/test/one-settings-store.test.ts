import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changeSettings } from '../../src/project.ts'
import { Settings } from '../server/live/settings.ts'

const was = process.env.LINECLEAR_CONFIG
const dirs: string[] = []
afterEach(() => {
  if (was === undefined) delete process.env.LINECLEAR_CONFIG
  else process.env.LINECLEAR_CONFIG = was
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

test('a model set in the project settings is what the next task starts on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'one-store-'))
  dirs.push(dir)
  process.env.LINECLEAR_CONFIG = dir
  mkdirSync(join(dir, 'projects', 'demo'), { recursive: true })
  const models = { worker: ['pi-a'], reviewer: ['pi-r'], planner: ['pi-p'] }
  writeFileSync(join(dir, 'projects', 'demo', 'settings.json'), JSON.stringify({ repo: '/x', space: 'demo', check: 'true', models }))
  const s = new Settings({ everywhere: {}, machine: {}, spaces: {} })
  expect(s.modelOf('task', 'pi', 'demo').model).toBe('pi-a')
  changeSettings('demo', { models: { worker: ['pi-b', 'pi-a'] } })
  expect(s.modelOf('task', 'pi', 'demo').model).toBe('pi-b')
  expect(s.modelOf('reviewer', 'pi', 'demo').model).toBe('pi-r')
})
