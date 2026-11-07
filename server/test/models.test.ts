// pi's models and effort levels, as the registry lists them (src/models.ts)
import { describe, expect, test } from 'bun:test'
import { chooseModel, findModel, firstModel, modelsOf, nearest, setRegistry, setRegistryReader } from '../../src/models.ts'

describe('reading what pi takes', () => {
  test('the registry lists a model no table knows, and a start with no model set is refused', () => {
    setRegistry([{ harness: 'pi', provider: 'fakeco', name: 'zeta-1' }])
    try {
      const c = modelsOf('pi')!
      expect(c.models.map((m) => [m.id, m.label])).toEqual([['fakeco/zeta-1', 'zeta-1']])
      expect(findModel('pi', 'zeta-1')?.id).toBe('fakeco/zeta-1')
      expect(chooseModel('pi')).toBe('No model is set for pi. Choose one of: fakeco/zeta-1.')
      expect(chooseModel('pi', 'zeta-1')).toBeUndefined()
      expect(chooseModel('gemini')).toBeUndefined()
    } finally {
      setRegistry([])
    }
    expect(modelsOf('pi')!.models).toEqual([])
    expect(chooseModel('pi')).toBeUndefined()
  })
  test('a start with no model takes the machine\'s first available one', () => {
    setRegistry([{ harness: 'pi', provider: 'fakeco', name: 'zeta-1' }, { harness: 'pi', provider: 'fakeco', name: 'alpha-2' }])
    try {
      expect(chooseModel('pi')).toBeDefined()
      expect(firstModel('pi')).toBe('fakeco/zeta-1')
      expect(firstModel('gemini')).toBeUndefined()
    } finally {
      setRegistry([])
    }
  })
  test('a fresh server reads the registry before it answers the first time', () => {
    setRegistryReader(() => [{ harness: 'pi', provider: 'fakeco', name: 'zeta-1' }])
    try {
      expect(findModel('pi', 'zeta-1')?.id).toBe('fakeco/zeta-1')
      expect(chooseModel('pi', 'zeta-1')).toBeUndefined()
    } finally {
      setRegistryReader(() => [])
      setRegistry([])
    }
  })
  test('a level a model lacks becomes the nearest it has, a tie going lower', () => {
    expect(nearest(['low', 'medium', 'high'], 'max')).toBe('high')
    expect(nearest(['low', 'high'], 'medium')).toBe('low')
    expect(nearest(['off', 'low'], 'none')).toBe('off')
    expect(nearest(['low'], 'nonsense')).toBeUndefined()
    expect(nearest(['low'], 'default')).toBeUndefined()
  })
})
