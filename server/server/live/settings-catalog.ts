import { cpus } from 'node:os'
import { NOTIFY, NOTIFY_DEFAULT, NOTIFY_KEY } from '../../shared/alerts.ts'
import { SEVERITIES } from './prompts.ts'
import { effortFor, effortsOf, findModel, LEVELS, modelsOf } from '../../../src/models.ts'
import { OWN_ZONE, validZone } from './trigger.ts'

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
const EFFORTS = ['default', ...LEVELS]

/** the CLIs a brief's Review line may suggest for a task's review */
export const REVIEWERS = ['pi']

/** the agents Settings picks a CLI, model and effort for */
export type Role = 'task' | 'coordinator' | 'reviewer' | 'backup'
export const ROLES: Role[] = ['task', 'coordinator', 'reviewer', 'backup']

/** a count or a threshold: any number from min to max (step 1: whole numbers), kept with its unit ("7 days", "80%");
 *  off: it may be off too ("off"), zero: 0 is off */
export interface Num {
  min: number
  max: number
  step?: number
  /** the unit after the number, plural and singular ("days", "day"); none: a bare number */
  unit?: string
  one?: string
  off?: boolean
  zero?: boolean
}

type Row = {
  label: string
  key: string
  value: string
  options?: string[]
  text?: boolean
  multiline?: boolean
  fixed?: boolean
  hint?: string
  lineclear?: string
  group?: string
  num?: Num
}

/** a level defaults are set at: Everywhere, this machine, or one of its spaces */
export type LevelKind = 'all' | 'machine' | 'space'
/** the levels a section's defaults may be set at (all three when none): a machine's capacity has no space level;
 *  alerts are one for all */
export type Section = { name: string; about?: string; rows: Row[]; levels?: LevelKind[]; told?: boolean; prompt?: boolean }

/** when this machine's tasks may start, and when its coordinator hears that the machine struggles (health.ts) */
export interface MachineLimits {
  /** tasks at work at once */
  max: number | null
  /** new tasks wait while the 1-minute load is over this many times the cores, or this much memory is in use (%);
   *  none: not limited by load */
  startLoad: number | null
  startMemory: number | null
  /** the coordinator is told when the load stays over this many times the cores for 10 minutes, memory or a disk is
   *  fuller than this (%), or herdr stops answering; null: that one is off */
  alertLoad: number | null
  alertMemory: number | null
  alertDisk: number | null
  alertHerdr: boolean
}

const CORES: Num = { min: 0.1, max: 20, step: 0.05, unit: '× cores' }
const PCT: Num = { min: 1, max: 100, unit: '%' }
/** tasks at once on a machine with this many cores, unless set: two stay for a full check and the server (docs/numbers.md) */
export const defaultMaxTasks = (cores = cpus().length) => Math.max(1, cores - 2)

const agentRows = (group: string, role: string, cli: string[], model: string, effort: string): Row[] => [
  { group, label: 'Agent', key: `${role}.agent`, value: cli[0], options: cli },
  { group, label: 'Model', key: `${role}.model`, value: model, text: true },
  { group, label: 'Effort', key: `${role}.effort`, value: effort, options: [...EFFORTS] },
]

export type Values = Record<string, string>

export const CATALOG: Section[] = [
  {
    name: 'Private instructions',
    prompt: true,
    about:
      'Personal rules kept outside your repos. Each role follows space → machine → Everywhere; an empty value means no private rules. Adds to team rules; explicit human instructions win. New starts or restarts only. No secrets here.',
    rows: [
      { label: 'Coordinators', key: 'coordinator.instructions', value: '', multiline: true },
      { label: 'Task agents', key: 'task.instructions', value: '', multiline: true },
      { label: 'Reviewers', key: 'reviewer.instructions', value: '', multiline: true },
    ],
  },
  {
    // what Lineclear adds to the end of every new task's brief
    name: 'How tasks work',
    told: true,
    about: "Each new task's brief ends with these in its Settings block, each as the line shown. To change one for a single task, tell its coordinator.",
    rows: [
      // on: the brief's Review line asks the task's agent for a fresh-eyes review before it merges
      { label: 'Review', key: 'brief.review', value: 'on', options: ['on', 'off'] },
      // the reviewer tags each finding; the agent fixes those at or above this one and reviews again, at most so many
      // rounds. Only words in the Review line: what counts as which is the skill's and the reviewer's judgment
      { label: 'Must fix', key: 'review.mustFix', value: 'major', options: [...SEVERITIES] },
      { label: 'Review rounds', key: 'review.rounds', value: '3 rounds', num: { min: 1, max: 10, unit: 'rounds', one: 'round' } },
      // on its own: once its own quick checks pass; GitHub's run on (pull request, main), and main's going red is told
      // to its coordinator (engine.watchMain). After GitHub checks: lineclear merge waits for them
      { label: 'Merge', key: 'brief.merge', value: 'on its own', options: ['on its own', 'after GitHub checks', 'ask me first'] },
      // only words in the brief's Reviewer line: the task's agent has its change reviewed however it sees fit
      ...agentRows('Reviewer', 'reviewer', [...REVIEWERS], 'default', 'default'),
    ],
  },
  {
    // which agent (CLI), model and effort each kind of agent starts with
    name: 'Agents',
    about:
      "What each kind of agent starts with: its CLI and effort. The models of tasks, reviewers and the backup are Lineclear's Settings > Models. Default is the agent's own effort. Backup takes a task over when its agent can't go on. Chat choices need a chat log reader; other installed CLIs cannot show replies here. Headless review is separate.",
    rows: [
      ...agentRows('Tasks', 'task', [...CLIS], 'default', 'default'),
      ...agentRows('Coordinators', 'coordinator', [...CLIS], 'default', 'default'),
      // a backup agent takes a task over where its agent can't go on (engine.ts cantGoOn)
      { group: 'Backup', label: 'Agent', key: 'task.fallback', value: 'pi', options: ['off', ...CLIS] },
      { group: 'Backup', label: 'Model', key: 'backup.model', value: 'default', text: true },
      { group: 'Backup', label: 'Effort', key: 'backup.effort', value: 'default', options: [...EFFORTS] },
    ],
  },
  {
    // Done tasks put themselves in their place's Archived view this long after they finished (engine.autoArchive)
    name: 'Tasks',
    about: "Done tasks move to their place's Archived list after this long.",
    rows: [{ label: 'Archive Done after', key: 'tasks.archiveAfter', value: '7 days', num: { min: 1, max: 3650, unit: 'days', one: 'day', off: true } }],
  },
  {
    // each machine's own: when its tasks may start (engine.release holds the rest as Queued) and when its coordinator
    // hears that it struggles (health.ts). Load is the 1-minute load average, in multiples of the machine's cores
    name: 'Machine',
    levels: ['all', 'machine'],
    about: "When a machine starts more tasks, and when its coordinator hears that it struggles. Set one machine's own to fit its cores and memory.",
    rows: [
      { group: 'Working tasks', label: 'Max tasks working at once', key: 'machine.maxTasks', value: String(defaultMaxTasks()), num: { min: 1, max: 200 } },
      { group: 'Working tasks', label: 'Wait while CPU load is over', key: 'machine.startLoad', value: '1× cores', num: CORES },
      { group: 'Working tasks', label: 'Wait while memory is over', key: 'machine.startMemory', value: '80%', num: PCT },
      { group: 'Tell its coordinator when', label: 'CPU load stays over (2 min)', key: 'machine.alertLoad', value: '1.5× cores', num: { ...CORES, off: true } },
      { group: 'Tell its coordinator when', label: 'Memory is over', key: 'machine.alertMemory', value: '90%', num: { ...PCT, off: true } },
      { group: 'Tell its coordinator when', label: 'Disk is over', key: 'machine.alertDisk', value: '90%', num: { ...PCT, off: true } },
      { group: 'Tell its coordinator when', label: 'herdr stops answering', key: 'machine.alertHerdr', value: 'on', options: ['on', 'off'] },
    ],
  },
  {
    // a task's shared browser closes after this long with no agent command and no one watching it in its Browser panel
    // (browser.ts closeIdle); its sign-ins stay, and the next command or a look starts it again
    name: 'Browser',
    about:
      "A task's browser closes after this long with no agent using it and no one watching it, so it stops using CPU. Sign-ins stay; the agent's next command or opening the Browser panel starts it again.",
    rows: [{ label: 'Close idle browser after', key: 'browser.idleClose', value: '10 min', num: { min: 1, max: 1440, unit: 'min', off: true } }],
  },
  {
    // what buzzes from each place's coordinator chat (shared/alerts.ts notifies); a machine's or space's own is set from its row's menu
    name: 'Notify',
    about:
      "Which alerts a place's coordinator chat sends you. All: every new message too. Needs me: its questions and alerts. Off: none, and its row stays quiet. Tasks alert you either way. A place can set its own from its menu in the sidebar.",
    rows: [{ label: 'Notify', key: NOTIFY_KEY, value: NOTIFY_DEFAULT, options: [...NOTIFY] }],
  },
  {
    // the zone every time rule's times are in: automations
    name: 'Time zone',
    levels: ['all'],
    about: 'The time zone of every schedule: automations, on every machine.',
    rows: [{ label: 'Time zone', key: 'time.zone', value: OWN_ZONE, text: true }],
  },
  {
    name: 'Alerts',
    levels: ['all'],
    about: 'The same on every machine and space.',
    rows: [{ label: 'Alerts on', key: 'alerts', value: 'No device yet', options: ['Add this device'] }],
  },
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

const ROWS = CATALOG.flatMap((s) => s.rows)
export const KEYS = ROWS.map((r) => r.key)

export function defaultOf(key: string) {
  return ROWS.find((r) => r.key === key)?.value
}
export type Level = 'all' | 'machine' | { space: string }

export const kindOfLevel = (l: Level): LevelKind => (typeof l === 'string' ? l : 'space')
export const levelsOf = (key: string): LevelKind[] => CATALOG.find((s) => s.rows.some((r) => r.key === key))?.levels ?? ['all', 'machine', 'space']
export interface Stored {
  everywhere: Values
  machine: Values
  spaces: Record<string, Values>
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
