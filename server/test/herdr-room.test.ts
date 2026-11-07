import { expect, test } from 'bun:test'
import { parseRoom, room } from '../server/live/herdr-forward.ts'

const MEMINFO = `MemTotal:       16000000 kB
MemFree:         1000000 kB
MemAvailable:    8000000 kB
`

test('the room reads /proc/meminfo text', () => {
  expect(parseRoom(0.52, MEMINFO, 8)).toEqual({ load: 0.52, cores: 8, freeKb: 8000000, totalKb: 16000000 })
  expect(parseRoom(0.52, 'nothing', 8)).toBeUndefined()
})

test('a macOS machine has no /proc: its room comes from the os module', () => {
  expect(room('darwin')).toMatchObject({ load: expect.any(Number), cores: expect.any(Number), freeKb: expect.any(Number), totalKb: expect.any(Number) })
})
