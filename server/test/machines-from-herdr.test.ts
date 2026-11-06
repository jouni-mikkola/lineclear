import { afterAll, expect, test } from 'bun:test'
import { src, stopSource } from './source-fixture.ts'

afterAll(stopSource)

const saved = (label: string, enabled = true) => ({ id: label, label, target: `${label}.local`, session: 'default', enabled })

test('the machines herdr has saved and enabled are the ones room and placement know, as the list changes', async () => {
  src.machineList = async () => [saved('elitebook'), saved('off', false)]
  await src.syncMachines()
  expect([...src.engine.machines.keys()]).toEqual(['elitebook'])
  // no herdr is here to read its room, but the machine is known
  expect((await src.cli(['room', 'elitebook'], {})).out).not.toContain('No machine called')
  expect((await src.cli(['room', 'off'], {})).out).toContain('No machine called off')

  src.machineList = async () => []
  await src.syncMachines()
  expect(src.engine.machines.size).toBe(0)
  expect((await src.cli(['room', 'elitebook'], {})).out).toContain('No machine called elitebook')
})
