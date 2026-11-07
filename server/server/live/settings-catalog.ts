import { effortFor, effortsOf, findModel, LEVELS, modelsOf } from '../../../src/models.ts'
import type { Row } from './settings-types.ts'

/** pi runs every agent: it is the one CLI to pick, by its name or its herdr kind */
export const CLIS: string[] = ['pi']
export const KIND: Record<string, string> = { pi: 'pi' }
export const CLI_NAME: Record<string, string> = { pi: 'pi' }

/** a CLI by its name or its herdr kind, any case: its kind */
export function kindOf(cli: string): string | undefined {
  return cli.trim().toLowerCase() === 'pi' ? 'pi' : undefined
}

/** the effort words a setting may hold: each CLI and model takes its own few of them (models.ts), the rest becoming the
 *  nearest it has */
export const EFFORTS = ['default', ...LEVELS]

/** the CLIs a brief's Review line may suggest for a task's review */
export const REVIEWERS = ['pi']

/** the agents Settings picks a CLI, model and effort for */
export type Role = 'task' | 'coordinator' | 'reviewer' | 'backup'
export const ROLES: Role[] = ['task', 'coordinator', 'reviewer', 'backup']

export const agentRows = (group: string, role: string, cli: string[], model: string, effort: string): Row[] => [
  { group, label: 'Agent', key: `${role}.agent`, value: cli[0], options: cli },
  { group, label: 'Model', key: `${role}.model`, value: model, text: true },
  { group, label: 'Effort', key: `${role}.effort`, value: effort, options: [...EFFORTS] },
]

/** the CLI a role's agent runs, by these settings: its herdr kind; nothing for an unset backup */
export const roleKind = (role: Role, get: (key: string) => string) =>
  kindOf(get(role === 'backup' ? 'task.fallback' : `${role}.agent`)) ?? (role === 'backup' ? undefined : 'pi')

/** the model rows Lineclear's lists replace: a model set here would disagree with the list that starts tasks */
export const LINECLEAR_MODELS = new Set(['task.model', 'reviewer.model', 'backup.model'])

/** a role's Model and Effort rows as its CLI has them, by these settings (r.value is the row's own): a pick of its
 *  models and of the levels its model takes, each showing what it starts with (a level the model lacks shows as the
 *  nearest it has); a CLI that can't list its models takes any id; one Lineclear passes neither to picks its own */
export function agentRow(r: Row, get: (key: string) => string): Row {
  const [role, what] = r.key.split('.') as [Role, string]
  if (!ROLES.includes(role) || (what !== 'model' && what !== 'effort')) return r
  // the worker, reviewer and backup models are Lineclear's ordered lists: shown here, set there
  if (what === 'model' && LINECLEAR_MODELS.has(r.key))
    return {
      ...r,
      value: 'Set in Lineclear',
      fixed: true,
      text: false,
      options: undefined,
      hint: "Lineclear's Settings > Models picks it: its ordered list for each role, and the next takes over when an account is full.",
      lineclear: '/settings',
    }
  const kind = roleKind(role, get)
  const c = kind ? modelsOf(kind) : undefined
  if (!kind || !c) return { ...r, value: kind ? `${CLI_NAME[kind] ?? kind}'s own` : 'off', fixed: true, text: false }
  const stored = get(`${role}.model`)
  const model = findModel(kind, stored)
  if (what === 'model') {
    if (!c.models.length) return { ...r, value: stored }
    const labels = c.models.map((m) => m.label)
    return {
      ...r,
      text: false,
      value: model?.label ?? 'default',
      options: ['default', ...labels, ...(model && !labels.includes(model.label) ? [model.label] : [])],
    }
  }
  const levels = effortsOf(kind, stored)
  if (!levels.length) return { ...r, value: 'none', fixed: true }
  return { ...r, value: effortFor(kind, r.value, stored) ?? 'default', options: ['default', ...levels] }
}
