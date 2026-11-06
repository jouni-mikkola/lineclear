import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CpuMeter, type CpuRow } from '../server/live/engine/cpu-meter.ts'

describe('cpu meter', () => {
  const row = (parent: number, ticks: number, cwd: string, cmd: string, childTicks = 0): CpuRow => ({ parent, ticks, childTicks, cwd, cmd })
  const tree = (extra: number) =>
    new Map<number, CpuRow>([
      [10, row(1, 100 + extra, '/w', 'pi --model m')],
      [11, row(10, 50 + extra, '/w', 'bun test x')],
      [12, row(11, 20, '/', 'node claude-bridge')],
      [13, row(10, 7 + extra, '/w/ui', 'bun run serve')],
      [99, row(1, 5000, '/other', 'pi')],
    ])

  test("adds each tick's CPU by kind for the task's tree only", () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpu-'))
    const meter = new CpuMeter(dir)
    expect(meter.sample('T-1', '/w', tree(0), 1000)).toEqual([])
    expect(meter.sample('T-1', '/w', tree(30), 2000)).toEqual([
      { at: 2000, kind: 'agent', ticks: 30 },
      { at: 2000, kind: 'tests', ticks: 30 },
      { at: 2000, kind: 'server', ticks: 30 },
    ])
    expect(readFileSync(join(dir, 'T-1.jsonl'), 'utf8').trim().split('\n')).toHaveLength(3)
  })

  test('a child that ended between ticks still counts once, and an ended process takes nothing from the others', () => {
    const meter = new CpuMeter(mkdtempSync(join(tmpdir(), 'cpu-')))
    const at = (a: Map<number, CpuRow>, n: number) => meter.sample('T-2', '/w', a, n)
    at(
      new Map([
        [10, row(1, 100, '/w', 'pi')],
        [11, row(10, 40, '/w', 'bun test a')],
        [12, row(10, 40, '/w', 'bun test b')],
      ]),
      1,
    )
    // 11 ended: its 45 ticks reach 10's waited-for children, 40 of them were seen; 12 used 10 more
    expect(
      at(
        new Map([
          [10, row(1, 103, '/w', 'pi', 45)],
          [12, row(10, 50, '/w', 'bun test b')],
        ]),
        2,
      ),
    ).toEqual([
      { at: 2, kind: 'agent', ticks: 8 },
      { at: 2, kind: 'tests', ticks: 10 },
    ])
  })
})
