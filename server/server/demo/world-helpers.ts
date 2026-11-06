import { defaultOf, kindOf } from '../live/settings.ts'

export const DEFAULT_WAYS = {
  review: defaultOf('brief.review') !== 'off',
  mustFix: defaultOf('review.mustFix')!,
  rounds: Number.parseInt(defaultOf('review.rounds')!, 10),
  merge: defaultOf('brief.merge')!,
  waitChecks: defaultOf('brief.merge') === 'after GitHub checks',
  checkWhere: 'local' as const,
}
export const DEFAULT_REVIEWER = { kind: kindOf(defaultOf('reviewer.agent')!)! }

export let seq = 1000
export const id = () => `d${++seq}`

// Claude Code's models and levels as live has them when it can't ask it (models.ts), on the second at high
export const CLAUDE_CONTROLS = () => ({
  models: ['Model Max 5.1', 'Model Top 5.5', 'Model Mid 5.5', 'Model Lite 5.5'],
  model: 1,
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  effort: 2,
})
/** a typed path, the way the demo's made-up folders are named: ~/dev/x, no trailing slash */
export function demoPath(path: string) {
  const parts: string[] = []
  for (const seg of path.trim().replace(/^~\/?/, '').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  if (path.trim().startsWith('/')) throw new Error('Only folders in your home can be added.')
  return ['~', ...parts].join('/')
}

// as live: other CLIs change model and effort only in their own pickers
export const OTHER_CONTROLS = () => ({ models: [], model: 0, efforts: [], effort: 0 })
