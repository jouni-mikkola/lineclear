import { describe, expect, test } from 'bun:test'
import { readerFor } from '../server/live/readers/index.ts'
import { sessionRuntime } from '../server/live/runtime.ts'

const at = 1_700_000_000_000
const lines = (...rows: unknown[]) => rows.map((row, offset) => ({ text: JSON.stringify(row), offset }))

describe('CLI runtime observations, independent of launch policy', () => {
  test('Pi separately records model and thinking changes, including off', () => {
    const ev = readerFor('pi')!.parse(
      lines(
        { type: 'model_change', timestamp: new Date(at).toISOString(), modelId: 'custom/provider-model' },
        { type: 'thinking_level_change', timestamp: new Date(at).toISOString(), thinkingLevel: 'high' },
        { type: 'thinking_level_change', timestamp: new Date(at).toISOString(), thinkingLevel: 'off' },
      ),
      'pi',
    )
    expect(sessionRuntime(ev, 'pi', 0)).toMatchObject({ model: 'custom/provider-model', effort: 'off' })
  })

  test('resumed Pi cannot reuse old thinking state; a fresh assistant reports the actual model', () => {
    const ev = readerFor('pi')!.parse(
      lines(
        { type: 'model_change', timestamp: new Date(at - 10).toISOString(), modelId: 'old-model' },
        { type: 'thinking_level_change', timestamp: new Date(at - 10).toISOString(), thinkingLevel: 'high' },
        { type: 'message', timestamp: new Date(at + 10).toISOString(), message: { role: 'assistant', model: 'resumed-model', content: [] } },
      ),
      'pi',
    )
    expect(sessionRuntime(ev, 'pi', at)).toMatchObject({ model: 'resumed-model' })
    expect(sessionRuntime(ev, 'pi', at)?.effort).toBeUndefined()
  })
})
