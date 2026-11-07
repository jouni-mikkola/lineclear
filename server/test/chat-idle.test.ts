// An idle chat agent's pane closes after 20 minutes; a younger one stays.
import { describe, expect, test } from 'bun:test'
import { ChatIdle } from '../server/live/chat-idle.ts'

const MIN = 60_000

describe('idle chat panes', () => {
  test('closes one idle 20 min and keeps one idle 19 min', () => {
    const idle = new ChatIdle()
    idle.status('old', 'idle', 0)
    idle.status('young', 'idle', 1 * MIN)
    expect(idle.due(20 * MIN)).toEqual(['old'])
    expect(idle.due(19 * MIN)).toEqual([])
    expect(idle.next(19 * MIN)).toBe(1 * MIN)
  })

  test('working restarts the clock, and a repeated idle does not', () => {
    const idle = new ChatIdle()
    idle.status('a', 'idle', 0)
    idle.status('a', 'idle', 10 * MIN)
    expect(idle.due(20 * MIN)).toEqual(['a'])
    idle.status('a', 'working', 15 * MIN)
    idle.status('a', 'idle', 16 * MIN)
    expect(idle.due(20 * MIN)).toEqual([])
    expect(idle.due(36 * MIN)).toEqual(['a'])
    idle.forget('a')
    expect(idle.next(36 * MIN)).toBeUndefined()
  })
})
