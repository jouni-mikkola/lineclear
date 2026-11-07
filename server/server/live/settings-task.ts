import type { SettingSection } from '../../shared/types/settings.ts'
import { CATALOG, numOf } from './settings-sections.ts'
import { numValue, refuse } from './settings-rules.ts'

/** task add's --set for one task: a How tasks work key by its Settings key or its short name, and the flag of task
 *  add's own the agent and reviewer keys stand for */
const ONE_TASK: Record<string, string> = {
  review: 'brief.review',
  merge: 'brief.merge',
  mustfix: 'review.mustFix',
  'must-fix': 'review.mustFix',
  rounds: 'review.rounds',
  'review-rounds': 'review.rounds',
}
const FLAG_OF: Record<string, string> = {
  'task.agent': 'agent',
  'task.model': 'model',
  'task.effort': 'effort',
  'reviewer.agent': 'reviewer',
  'reviewer.model': 'reviewer-model',
  'reviewer.effort': 'reviewer-effort',
}

/** one --set key=value: a How tasks work setting for this task as Settings keeps it, the task add flag it stands for
 *  (agent, model, effort, reviewer…), or why it can't be */
export function setForTask(pair: string): { key: string; value: string } | { flag: string; value: string } | { error: string } {
  const eq = pair.indexOf('=')
  const name = pair.slice(0, eq).trim()
  const value = pair
    .slice(eq + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
  const told = CATALOG.filter((x) => x.told).flatMap((x) => x.rows.map((r) => r.key))
  const short = name.toLowerCase()
  const key =
    told.find((k) => k.toLowerCase() === short) ??
    ONE_TASK[short] ??
    (FLAG_OF[`task.${short}`] && `task.${short}`) ??
    (short === 'reviewer' ? 'reviewer.agent' : Object.keys(FLAG_OF).find((k) => k.toLowerCase() === short))
  if (eq < 1 || !key)
    return {
      error: `--set takes key=value, a key of: ${[...told.filter((k) => !FLAG_OF[k]), 'agent', 'model', 'effort', 'reviewer', 'reviewer.model', 'reviewer.effort'].join(', ')} (lineclear show has them)`,
    }
  if (FLAG_OF[key]) return { flag: FLAG_OF[key], value }
  const err = refuse(key, value)
  if (err) return { error: `--set ${name}: ${err}` }
  const num = numOf(key)
  return { key, value: num ? numValue(num, value)! : value }
}

/** A repository's own destination; it has no machine or Everywhere fallback. */
export const repositorySection = (level: string, machine: string, base: string, install = ''): SettingSection => ({
  name: 'Repository',
  machine,
  level,
  rows: [
    {
      key: 'space.base',
      label: 'Base branch',
      value: base,
      text: true,
      hint: 'New tasks start from and merge into this branch. Existing tasks keep their target.',
    },
    {
      key: 'space.install',
      label: 'Install step',
      value: install,
      text: true,
      hint: 'Runs in each new task worktree before its agent starts. Empty: bun install --frozen-lockfile in Bun repos. off: none.',
    },
  ],
})
