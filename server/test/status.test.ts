import { describe, expect, test } from 'bun:test'
import { NEED } from '../server/live/engine/status.ts'
import { repo, world, started } from './engine-world.ts'

describe('L146: task status', () => {
  test('the words a task that waits on you shows', () => {
    expect(Object.values(NEED)).toEqual(['Plan to approve', 'Asks permission', 'Signed out', 'Question for you', 'Waits for your reply'])
  })

  test('a working agent is Working, an idle one with no report waits for your reply', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'status')
    w.agentIs(key, 'working')
    expect(w.engine.statusOf(t)).toBe('work')
    expect(w.engine.subOf(t)).toBe('Working')
    w.chat.reply = 'Done for now.'
    w.agentIs(key, 'idle')
    expect(w.engine.statusOf(t)).toBe('need')
    expect(w.engine.subOf(t)).toBe(NEED.reply)
  })
})
