// The models a CLI would list, for tests that need Claude Code and Codex to know some: the server builds in none
import { type CliModels, type Model, setModels } from '../server/live/models.ts'

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const model = (id: string, label: string, effort: string, ultra = false): Model => ({ id, label, efforts: ultra ? [...LEVELS, 'ultra'] : LEVELS, effort })

export const CLAUDE_MODELS: CliModels = {
  models: [
    model('claude-fable-5-1', 'Fable 5.1', 'high'),
    model('claude-opus-5-5', 'Opus 5.5', 'medium'),
    model('claude-sonnet-5-5', 'Sonnet 5.5', 'medium'),
    model('claude-haiku-5-5', 'Haiku 5.5', 'medium'),
  ],
  efforts: LEVELS,
}

const CODEX_MODELS: CliModels = {
  models: [
    model('gpt-6.1-sol', 'GPT-6.1-Sol', 'low', true),
    model('gpt-6-astra', 'GPT-6-Astra', 'medium', true),
    model('gpt-6-sol', 'GPT-6-Sol', 'medium', true),
    model('gpt-6-luna', 'GPT-6-Luna', 'medium'),
    model('gpt-5.6-sol', 'GPT-5.6-Sol', 'low', true),
    model('gpt-5.6-terra', 'GPT-5.6-Terra', 'medium', true),
    model('gpt-5.6-luna', 'GPT-5.6-Luna', 'medium'),
  ],
  efforts: [...LEVELS, 'ultra'],
}

export function seedModels() {
  setModels('claude', CLAUDE_MODELS)
  setModels('codex', CODEX_MODELS)
}
