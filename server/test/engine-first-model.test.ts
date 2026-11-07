// A task started with pi's default model unset takes the machine's first available model and says so in its facts.
import { expect, test } from 'bun:test'
import { setRegistry } from '../../src/models.ts'
import { repo, started, world } from './engine-world.ts'

test('no default model: the first available one is chosen and noted in the facts', async () => {
  setRegistry([
    { harness: 'pi', provider: 'fakeco', name: 'zeta-1' },
    { harness: 'pi', provider: 'fakeco', name: 'zeta-2' },
  ])
  try {
    const w = world()
    w.settings.set('task.agent', 'pi')
    w.settings.set('task.model', null)
    const { t } = await started(w, repo(), 'first-model')
    expect(t.agent?.model).toBe('fakeco/zeta-1')
    expect(t.facts).toContain('fakeco/zeta-1')
    const set = w.engine.add({ project: t.project, title: 'Chosen', by: 'test', agent: { model: 'fakeco/zeta-2' } })
    expect(set.agent?.model).toBe('fakeco/zeta-2')
    expect(set.facts).toBeUndefined()
  } finally {
    setRegistry([])
  }
})
