import { expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(60_000)
// HOST is read once at import, so this machine is named before the modules load
process.env.LINECLEAR_MACHINE = 'machine-b'
const { placeId, repo, world } = await import('./engine-world.ts')
type TaskRec = import('../server/live/engine/engine-helpers.ts').TaskRec

const mk = (id: string, n: number, project: string, created: number) =>
  ({ id, n, project, title: 'Say hello', desc: '', by: 'test', created, updated: created }) as TaskRec

test('two stores holding OMA-91: the later is renamed, aliased machine-b:OMA-91, and show and close reach it by either form', async () => {
  const a = world()
  const b = world()
  const pa = await a.places.add(repo(), 'uniq')
  const pb = await b.places.add(repo(), 'uniq')
  const first = mk('OMA-91', 91, placeId.space(pa.name), 1000)
  const later = mk('OMA-91', 91, placeId.space(pb.name), 2000)
  a.engine.taskIds.ensure(first.project, pa.key)
  b.engine.taskIds.ensure(later.project, pb.key)
  a.engine.tasks.push(first)
  b.engine.tasks.push(later)

  a.engine.unifyIds([{ machine: 'machine-b', tasks: [{ id: 'OMA-91', createdAt: 2000 }] }])
  expect(first.id).toBe('OMA-91')
  b.engine.unifyIds([{ machine: 'machine-a', tasks: [{ id: 'OMA-91', createdAt: 1000 }] }])

  expect(later.id).not.toBe('OMA-91')
  expect(later.id).toMatch(new RegExp(`^${pb.key}-\\d+$`))
  expect(later.aliases).toEqual(['machine-b:OMA-91'])
  expect(b.engine.task(later.id)).toBe(later)
  expect(b.engine.task('machine-b:OMA-91')).toBe(later)
  expect(a.engine.task('OMA-91')).toBe(first)

  await b.engine.close('machine-b:OMA-91', 'Not needed.', undefined, true)
  expect(later.closed).toBeTruthy()
  expect(first.closed).toBeFalsy()
  await a.engine.close('OMA-91', 'Not needed.', undefined, true)
  expect(first.closed).toBeTruthy()
})
