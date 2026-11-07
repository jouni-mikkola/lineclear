import { expect, test } from 'bun:test'
import { room } from '../server/live/herdr-forward.ts'

const PROC = `0.52 0.40 0.30 1/200 999
MemTotal:       16000000 kB
MemFree:         1000000 kB
MemAvailable:    8000000 kB
8
`

test('room reads /proc text from one ssh call', async () => {
  const calls: string[] = []
  const read = await room('elite', async (machine, script) => {
    calls.push(`${machine}: ${script}`)
    return PROC
  })
  expect(read).toEqual({ load: 0.52, cores: 8, freeKb: 8000000, totalKb: 16000000 })
  expect(calls).toHaveLength(1)
})

test('room is undefined when ssh fails', async () => {
  expect(await room('elite', async () => undefined)).toBeUndefined()
})
