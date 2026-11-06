import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CpuMeter, type CpuRow, readProc } from '../server/live/engine/cpu-meter.ts'

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

  test('a fixed /proc tree gives each kind its ticks', () => {
    const root = mkdtempSync(join(tmpdir(), 'proc-'))
    const work = mkdtempSync(join(tmpdir(), 'wt-'))
    // pid, parent, utime, stime, cmdline: pi and its bridge, a test run and a server it started
    const proc = (pid: number, parent: number, used: number, cmd: string) => {
      mkdirSync(join(root, String(pid)), { recursive: true })
      writeFileSync(join(root, String(pid), 'stat'), `${pid} (${cmd.split(' ')[0]}) S ${parent} 0 0 0 0 0 0 0 0 0 ${used} 0 0 0 0 0 0 0 0 0`)
      writeFileSync(join(root, String(pid), 'cmdline'), cmd.split(' ').join('\0'))
      if (!existsSync(join(root, String(pid), 'cwd'))) symlinkSync(work, join(root, String(pid), 'cwd'))
    }
    proc(10, 1, 100, 'pi --model m')
    proc(11, 10, 40, 'node claude-bridge')
    proc(12, 10, 60, 'bun test x')
    proc(13, 12, 5, 'bun run serve')
    const first = readProc(root)
    expect(first.get(12)).toEqual({ parent: 10, ticks: 60, childTicks: 0, cwd: work, cmd: 'bun test x' })
    const meter = new CpuMeter(mkdtempSync(join(tmpdir(), 'cpu-')))
    meter.sample('T-3', work, first, 1)
    proc(10, 1, 160, 'pi --model m')
    proc(11, 10, 50, 'node claude-bridge')
    proc(12, 10, 360, 'bun test x')
    proc(13, 12, 25, 'bun run serve')
    expect(meter.sample('T-3', work, readProc(root), 2)).toEqual([
      { at: 2, kind: 'agent', ticks: 60 },
      { at: 2, kind: 'bridge', ticks: 10 },
      { at: 2, kind: 'tests', ticks: 300 },
      { at: 2, kind: 'server', ticks: 20 },
    ])
  })
})
