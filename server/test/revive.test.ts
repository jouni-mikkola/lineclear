// An agent that stopped is started again: tries are spaced out and end, so a start that keeps failing never loops.
import { describe, expect, test } from 'bun:test'
import { Revivals } from '../server/live/revive.ts'

describe('tries at starting it again', () => {
  const times = { grace: 20, gaps: [0, 60, 300], steady: 600 }

  test('only once it was seen wrong a while, then further apart, then given up once', () => {
    const r = new Revivals(times)
    expect(r.seen('a', 0)).toBeUndefined()
    expect(r.seen('a', 20)).toBe('go')
    // judged again only after its grace, and the next try after its gap
    expect(r.seen('a', 30)).toBeUndefined()
    expect(r.seen('a', 50)).toBeUndefined()
    expect(r.seen('a', 80)).toBe('go')
    expect(r.seen('a', 100)).toBeUndefined()
    expect(r.seen('a', 200)).toBeUndefined()
    expect(r.seen('a', 380)).toBe('go')
    expect(r.seen('a', 400)).toBeUndefined()
    expect(r.seen('a', 420)).toBe('give-up')
    for (const t of [500, 1000, 5000]) expect(r.seen('a', t)).toBeUndefined()
  })

  test('running well a while without a break counts from none again; a moment of it does not', () => {
    const r = new Revivals(times)
    r.seen('a', 0)
    expect(r.seen('a', 20)).toBe('go')
    // up for a moment after its start, then down again: still its second try, after the gap
    r.fine('a', 25)
    r.seen('a', 30)
    expect(r.seen('a', 50)).toBeUndefined()
    expect(r.seen('a', 80)).toBe('go')
    // well for a while, but with a break: still its third try, after the gap
    r.fine('a', 400)
    r.seen('a', 900)
    r.fine('a', 920)
    r.fine('a', 1500)
    r.seen('a', 1510)
    expect(r.seen('a', 1530)).toBe('go')
    // well without a break as long as steady: from none again
    r.fine('a', 1540)
    r.fine('a', 2140)
    r.seen('a', 2150)
    expect(r.seen('a', 2170)).toBe('go')
    r.seen('a', 2180)
    expect(r.seen('a', 2200)).toBeUndefined()
  })

  test('given up, it starts again only once it ran well for a while (the human restarted it)', () => {
    const r = new Revivals({ grace: 0, gaps: [0], steady: 100 })
    expect(r.seen('a', 0)).toBe('go')
    expect(r.seen('a', 1)).toBe('give-up')
    r.fine('a', 50)
    expect(r.seen('a', 60)).toBeUndefined()
    r.fine('a', 100)
    r.fine('a', 200)
    expect(r.seen('a', 210)).toBe('go')
  })

  test('remembers whether it was at work when it stopped', () => {
    const r = new Revivals(times)
    r.status('a', 'working')
    r.status('a', 'gone')
    expect(r.wasWorking('a')).toBe(true)
    r.status('a', 'idle')
    expect(r.wasWorking('a')).toBe(false)
  })
})
