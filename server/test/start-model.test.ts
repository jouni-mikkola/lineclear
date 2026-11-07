// a start with no default model set for pi takes the machine's first available model and says so in the facts
import { expect, test } from 'bun:test'
import { setRegistry } from '../../src/models.ts'
import { repo, started, world } from './engine-world.ts'

test('a task started with no model set gets the first available one, noted in its facts', async () => {
  setRegistry([
    { harness: 'pi', provider: 'fakeco', name: 'zeta-1' },
    { harness: 'pi', provider: 'fakeco', name: 'zeta-2' },
  ])
  try {
    const w = world()
    const { t, key } = await started(w, repo(), 'firstmodel')
    expect(t.facts).toContain('fakeco/zeta-1')
    expect(w.records[key].finished).toBeFalsy()
  } finally {
    setRegistry([])
  }
})
