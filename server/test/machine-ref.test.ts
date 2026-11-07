import { expect, test } from 'bun:test'
import { machineRef } from '../server/live/box.ts'

test('machine:id and id@machine name a task on that machine; anything else is the reference itself', () => {
  expect(machineRef('farhost:OMA-91')).toEqual({ machine: 'farhost', id: 'OMA-91' })
  expect(machineRef('OMA-91@farhost')).toEqual({ machine: 'farhost', id: 'OMA-91' })
  expect(machineRef('OMA-91')).toEqual({ id: 'OMA-91' })
  expect(machineRef('Fix: the thing')).toEqual({ id: 'Fix: the thing' })
})
