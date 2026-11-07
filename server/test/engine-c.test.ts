import { fitStatus, reportOf } from './engine-fixture.ts'
import { describe, expect, test } from 'bun:test'
import { seedModels } from './model-fixture.ts'

seedModels()

describe("a task's own status line, % done and time left", () => {
  test('a status line longer than 40 characters is cut cleanly at a word', () => {
    expect(fitStatus('Fixing the two failing tests')).toBe('Fixing the two failing tests')
    expect(fitStatus('Fresh-eyes review running; awaiting plan approval for part 2')).toBe('Fresh-eyes review running; awaiting plan')
    // no dangling comma or "and" where it was cut
    expect(fitStatus('Updating file locations and running the checks')).toBe('Updating file locations and running')
    expect(fitStatus('Reading skill docs, searching old group names')).toBe('Reading skill docs, searching old group')
    expect(fitStatus('Moving the skills folder into the template and then')).toBe('Moving the skills folder')
    expect(fitStatus('Running checks for the whole workspace, and')).toBe('Running checks for the whole workspace')
    // one word too long for the line is cut where the line ends
    expect(fitStatus('x'.repeat(50))).toBe('x'.repeat(40))
    for (const t of ['a b c '.repeat(20), 'Rebasing onto main and rerunning all of the checks again']) expect(fitStatus(t).length).toBeLessThanOrEqual(40)
  })
  test('the minutes left count down while it works, stop while it waits on you, and nothing shows once its job is over', () => {
    const r = { msg: 'Fixing tests', progress: 40, left: 12, at: 0 }
    expect(reportOf(r, 'work', 0)).toEqual({ msg: 'Fixing tests', progress: 40, eta: 12, paused: undefined })
    expect(reportOf(r, 'work', 5 * 60_000)!.eta).toBe(7)
    expect(reportOf(r, 'work', 30 * 60_000)!.eta).toBe(0)
    expect(reportOf({ ...r, pausedAt: 5 * 60_000 }, 'need', 60 * 60_000)).toEqual({ msg: 'Fixing tests', progress: 40, eta: 7, paused: true })
    expect(reportOf({ ...r, left: undefined }, 'work', 0)!.eta).toBeUndefined()
    for (const s of ['ready', 'done', 'todo', 'queued'] as const) expect(reportOf(r, s, 0)).toBeUndefined()
    expect(reportOf(undefined, 'work')).toBeUndefined()
  })
})
