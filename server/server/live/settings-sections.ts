import { cpus } from 'node:os'
import { NOTIFY, NOTIFY_DEFAULT, NOTIFY_KEY } from '../../shared/alerts.ts'
import { SEVERITIES } from './prompts.ts'
import { agentRows, CLIS, EFFORTS, REVIEWERS } from './settings-catalog.ts'
import type { Level, LevelKind, Num, Section } from './settings-types.ts'

/** the time zone this machine runs in: time.zone's default */
const OWN_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const CORES: Num = { min: 0.1, max: 20, step: 0.05, unit: '× cores' }
const PCT: Num = { min: 1, max: 100, unit: '%' }
/** tasks at once on a machine with this many cores, unless set: two stay for a full check and the server (docs/numbers.md) */
export const defaultMaxTasks = (cores = cpus().length) => Math.max(1, cores - 2)

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
    // what buzzes from each place's coordinator chat (shared/alerts.ts notifies); a machine's or space's own is set from its row's menu
    name: 'Notify',
    about:
      "Which alerts a place's coordinator chat sends you. All: every new message too. Needs me: its questions and alerts. Off: none, and its row stays quiet. Tasks alert you either way. A place can set its own from its menu in the sidebar.",
    rows: [{ label: 'Notify', key: NOTIFY_KEY, value: NOTIFY_DEFAULT, options: [...NOTIFY] }],
  },
  {
    name: 'Time zone',
    levels: ['all'],
    about: 'The time zone of every schedule, on every machine.',
    rows: [{ label: 'Time zone', key: 'time.zone', value: OWN_ZONE, text: true }],
  },
  {
    name: 'Alerts',
    levels: ['all'],
    about: 'The same on every machine and space.',
    rows: [{ label: 'Alerts on', key: 'alerts', value: 'No device yet', options: ['Add this device'] }],
  },
]

export const ROWS = CATALOG.flatMap((s) => s.rows)
export const KEYS = ROWS.map((r) => r.key)

export function defaultOf(key: string) {
  return ROWS.find((r) => r.key === key)?.value
}

export const kindOfLevel = (l: Level): LevelKind => (typeof l === 'string' ? l : 'space')
export const levelsOf = (key: string): LevelKind[] => CATALOG.find((s) => s.rows.some((r) => r.key === key))?.levels ?? ['all', 'machine', 'space']

export const numOf = (key: string) => ROWS.find((r) => r.key === key)?.num
