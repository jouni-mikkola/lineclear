import { afterAll, expect, test } from 'bun:test'
import { src, stopSource } from './source-fixture.ts'

afterAll(stopSource)

test('a machine herdr has saved is known to room at once, and to placement once it was looked at', async () => {
  // herdr lists elitebook; no worker is up and it was not looked at yet
  const l = src.peers!.adopt('elitebook', 'http://127.0.0.1:1')
  expect((await src.cli(['room', 'elitebook'], {})).out).not.toContain('No machine called')
  expect((await src.cli(['room', 'nowhere'], {})).out).toContain('No machine called nowhere')
  expect(src.engine.machines.has('elitebook')).toBe(false)

  l.probe = { home: '/home/e', os: 'Linux', arch: 'x86_64', path: '/usr/bin', herdr: 'herdr', tools: {}, helper: '' }
  src.syncMachines()
  expect(src.engine.machines.get('elitebook')?.home).toBe('/home/e')
})
