// Each CLI's models and effort levels, as read from the CLI itself (models.ts): what its output looks like here
import { describe, expect, test } from 'bun:test'
import { chooseModel, findModel, modelsOf, nearest, parseClaude, setRegistry, setRegistryReader } from '../server/live/models.ts'
import { seedModels } from './model-fixture.ts'

describe('reading what each CLI takes', () => {
  test("Claude Code's catalog: the newest of each family, its levels by capability, older ones by id", () => {
    const grep = [
      '{id:"claude-haiku-4-5",family:"haiku",display_name:"Haiku 4.5"',
      'capabilities:["context_management"]',
      '{id:"claude-haiku-5-5",family:"haiku",display_name:"Haiku 5.5"',
      'capabilities:["effort","max_effort","xhigh_effort"]',
      'default_effort:"medium"',
      '{id:"claude-sonnet-4-6",family:"sonnet",display_name:"Sonnet 4.6"',
      'capabilities:["effort","max_effort"]',
      '{id:"claude-opus-5-5",family:"opus",display_name:"Opus 5.5"',
      'capabilities:["effort","max_effort","xhigh_effort"]',
      'default_effort:"medium"',
      '{id:"claude-fable-5-1",family:"fable",display_name:"Fable 5.1"',
      'capabilities:["effort","xhigh_effort"]',
      'default_effort:"high"',
      // another catalog's later in the file: not a model's
      'capabilities:["web_search"]',
      'default_effort:"xhigh"',
    ].join('\n')
    const help =
      '  --effort <level>                      Effort level for the current session\n                                        (low, medium, high, xhigh, max)\n'
    const c = parseClaude(grep, help)!
    expect(c.models.map((m) => [m.label, m.efforts.join(' '), m.effort])).toEqual([
      ['Fable 5.1', 'low medium high xhigh', 'high'],
      ['Opus 5.5', 'low medium high xhigh max', 'medium'],
      ['Sonnet 4.6', 'low medium high max', undefined],
      ['Haiku 5.5', 'low medium high xhigh max', 'medium'],
    ])
    expect(c.others!.map((m) => [m.id, m.efforts])).toEqual([['claude-haiku-4-5', []]])
    expect('default' in c).toBe(false)
    expect(parseClaude('', help)).toBeUndefined()
  })
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
    // aliases name a family's newest
    seedModels()
    expect(findModel('claude', 'sonnet')?.id).toBe('claude-sonnet-5-5')
    expect(findModel('claude', 'HAIKU 5.5')?.id).toBe('claude-haiku-5-5')
  })
})
