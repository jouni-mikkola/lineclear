import { effortFor, effortsOf, findModel, modelsOf } from '../../../src/models.ts'
import { CLI_NAME, kindOf, REVIEWERS, ROWS } from './settings-catalog.ts'
import type { Num, Role, Row } from './settings-types.ts'
import { ROLES } from './settings-types.ts'

function validZone(zone: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

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

export const numOf = (key: string) => ROWS.find((r) => r.key === key)?.num

/** a number as it is kept ("7 days", "1.5× cores", "off"), or nothing where it is no number in range */
export function numValue(n: Num, value: string): string | undefined {
  const v = value.trim().toLowerCase()
  if (v === 'off') return n.off || n.zero ? 'off' : undefined
  // its unit (or any word of it) may follow: "13", "13 tasks", "1.5x cores", "80 %"
  const m = v.match(/^(\d+(?:[.,]\d+)?)\s*(?:[×x%]|[a-z][a-z ]*)?\s*(?:cores?)?$/)
  if (!m) return undefined
  const x = Number(m[1].replace(',', '.'))
  if (n.zero && x === 0) return 'off'
  const step = n.step ?? 1
  if (x < n.min || x > n.max || Math.abs(Math.round(x / step) * step - x) > 1e-9) return undefined
  const unit = x === 1 && n.one ? n.one : n.unit
  return unit ? `${x}${unit.startsWith('×') || unit === '%' ? '' : ' '}${unit}` : String(x)
}

/** why a value can't be set, or nothing */
export function refuse(key: string, value: string): string | undefined {
  if (key.endsWith('.instructions') && (value.length > 16000 || value.includes('\0')))
    return 'Use at most 16,000 characters, without null characters. Keep secrets in Secrets.'
  const cli = key === 'task.agent' || key === 'coordinator.agent' || (key === 'task.fallback' && value.trim().toLowerCase() !== 'off')
  if (cli && !kindOf(value)) return `${value} is not an agent herdr can start.`
  if (key === 'reviewer.agent' && !REVIEWERS.includes(CLI_NAME[kindOf(value) ?? ''] ?? '')) return `Pick one of: ${REVIEWERS.join(' · ')}.`
  if (key.endsWith('.model') && !/^[\w.:/@[\] -]+$/.test(value.trim())) return 'Write a model id like vendor/model-top-5-5, or default.'
  const num = numOf(key)
  if (key === 'time.zone' && !validZone(value.trim())) return `${value} is no time zone: write one like Europe/Stockholm.`
  if (num && numValue(num, value) === undefined)
    return `Write a number from ${num.min} to ${num.max}${num.step ? '' : ' (whole)'}${num.unit ? `, in ${num.unit}` : ''}${num.off ? ', or off' : num.zero ? ' (0 is off)' : ''}.`
  const options = ROWS.find((r) => r.key === key)?.options
  if (options && !cli && key !== 'reviewer.agent' && key !== 'alerts' && key !== 'task.fallback' && !options.includes(value))
    return `Pick one of: ${options.join(' · ')}.`
  return undefined
}
