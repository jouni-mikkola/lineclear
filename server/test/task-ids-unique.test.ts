import { expect, setDefaultTimeout, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskIds, renameLater, type Owned } from '../server/live/task-ids.ts'
import { HOST } from '../server/live/places.ts'
import { Machines } from '../server/live/machines.ts'
import type { Space } from '../server/live/places.ts'
import type { TaskRec } from '../server/live/engine/engine-helpers.ts'
import { placeId, repo, world } from './engine-world.ts'

setDefaultTimeout(60_000)

const space = (): Space => ({ name: 'oma', key: 'OMA', path: '/repos/oma', github: null, base: 'main', added: 1 })
const sp = 'p:machine:oma'
const idOf = () => sp
const store = (last: number) => new TaskIds([space()], { next: { OMA: last }, tasks: [] }, idOf, mkdtempSync(join(tmpdir(), 'shep-uniq-')))
const task = (id: string, created: number): Owned => ({ id, n: Number(id.split('-')[1]), project: sp, created })

test('the later of two tasks with one id is renamed from the space series and keeps the old id as an alias', () => {
  const a = store(91)
  const b = store(91)
  try {
    const first = task('OMA-91', 1000)
    const later = task('OMA-91', 2000)
    expect(renameLater(a, 'machine-a', [first], [{ machine: 'machine-b', tasks: [later] }])).toEqual([])
    expect(renameLater(b, 'machine-b', [later], [{ machine: 'machine-a', tasks: [first] }])).toEqual([{ from: 'OMA-91', to: 'OMA-92' }])
    expect(later.id).toBe('OMA-92')
    expect(later.aliases).toEqual(['machine-b:OMA-91'])
    expect(first.id).toBe('OMA-91')
  } finally {
    a.close()
    b.close()
  }
})

test('show and close reach the renamed task by its new id and by machine:old-id, and the other by the old id', async () => {
  const w = world()
  const p = await w.places.add(repo(), 'uniq')
  const t = { id: 'OMA-91', n: 91, project: placeId.space(p.name), title: 'Say hello', desc: '', by: 'test', created: 5000, updated: 5000 } as TaskRec
  w.engine.taskIds.ensure(t.project, p.key)
  w.engine.tasks.push(t)
  const old = t.id
  const dependant = { ...t, id: 'OMA-90', n: 90, after: [old] } as TaskRec
  w.engine.tasks.push(dependant)
  const theirs = { machine: 'machine-a', tasks: [{ id: old, createdAt: t.created - 1000 }] }
  w.engine.unifyIds([theirs])
  expect(t.id).not.toBe(old)
  expect(w.engine.task(t.id)).toBe(t)
  expect(w.engine.task(`${HOST}:${old}`)).toBe(t)
  expect(w.engine.task(old)).toBeUndefined()
  expect(t.aliases).toEqual([`${HOST}:${old}`])
  expect(dependant.after).toEqual([t.id])
  await w.engine.close(w.engine.task(`${HOST}:${old}`)!.id, 'Not needed.', undefined, true)
  expect(w.engine.task(t.id)?.closed).toBeTruthy()
})

test('a task on another machine is found by its id alone', () => {
  const peers = new Machines(null)
  try {
    const link = peers.adopt('machine-b', 'http://127.0.0.1:1')
    link.snap = { tasks: [{ id: 'OMA-91', place: 'p:machine-b:oma' }] } as never
    expect(peers.owner('OMA-91')?.rec.machine).toBe('machine-b')
    expect(peers.owner('OMA-92')).toBeUndefined()
  } finally {
    peers.stop()
  }
})

test('tasks started on two machines at once never repeat an id', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-uniq-'))
  const one = new TaskIds([space()], { next: {}, tasks: [] }, idOf, home)
  const two = new TaskIds([space()], { next: {}, tasks: [] }, idOf, home)
  try {
    const ids = await Promise.all(Array.from({ length: 40 }, (_, i) => Promise.resolve().then(() => (i % 2 ? one : two).allocate(sp).id)))
    expect(new Set(ids).size).toBe(40)
  } finally {
    one.close()
    two.close()
  }
})

test('a rename skips ids other machines hold, and a task the caller keeps still keeps its id', () => {
  const ids = store(91)
  try {
    const later = task('OMA-91', 2000)
    const others = [{ machine: 'machine-a', tasks: [task('OMA-91', 1000), task('OMA-92', 1500)] }]
    renameLater(ids, 'machine-b', [later], others)
    expect(later.id).toBe('OMA-93')
    const running = task('OMA-91', 3000)
    expect(renameLater(ids, 'machine-b', [running], others, () => false)).toEqual([])
    expect(running.id).toBe('OMA-91')
  } finally {
    ids.close()
  }
})
