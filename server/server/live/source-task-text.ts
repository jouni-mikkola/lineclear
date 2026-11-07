import type { Task } from '../../shared/types/task.ts'
import type { Parsed } from './args.ts'
import { NAME } from './places.ts'
import { statusLine } from './source-helpers.ts'

/** the flags `lineclear task add` takes (--brief is --desc's old name) */
const ADD_FLAGS = [
  'desc',
  'result',
  'space',
  'base',
  'after',
  'later',
  'set',
  'agent',
  'model',
  'effort',
  'reviewer',
  'reviewer-model',
  'reviewer-effort',
  'on',
  'reopened',
]

/** the flag `task add` does not take, as the error that names it; nothing when all are known */
export function oddAddFlag(p: Parsed) {
  const odd = [...Object.keys(p.opts), ...p.flags].find((f) => f !== 'brief' && !ADD_FLAGS.includes(f))
  return (
    odd &&
    `Task add takes no --${odd}: only ${ADD_FLAGS.map((f) => `--${f}`)
      .join(', ')
      .replace(/, ([^,]*)$/, ' and $1')}`
  )
}

/** why a task is held, as the CLI says it */
export const heldBecause = (why: string, max: number | null) => (why === 'slots' ? `all ${max} slots are taken` : 'the machine is busy')

const machineOf = (t: Task) => t.machine || NAME

/** the tasks as `lineclear task list --json`; `stopped` names the ids the owner stopped (a tell would start them again) */
export function taskListJson(all: Task[], stopped: (id: string) => boolean) {
  return JSON.stringify(
    all.map((t) => ({
      id: t.id,
      title: t.name,
      status: t.status,
      result: t.result,
      sub: statusLine(t),
      closed: t.closed ? true : undefined,
      closedBy: t.closed ? t.closedBy : undefined,
      machine: machineOf(t),
      space: t.place?.split(':').slice(2).join(':'), // the name `--space` takes
      archived: t.archived,
      pinned: t.pinned,
      orphaned: t.orphaned,
      stopped: stopped(t.id) || undefined,
    })),
    null,
    2,
  )
}

export const taskListRow = (t: Task) =>
  `${t.id.padEnd(8)} ${t.status.padEnd(5)} ${t.name}${t.pinned ? '  (pinned)' : ''}${statusLine(t) ? `  · ${statusLine(t)}` : ''}  (on ${machineOf(t)})`

/** `lineclear task show` */
export function taskShowText(v: Task) {
  return [
    `${v.id} ${v.name}`,
    `State: ${v.state}${statusLine(v) ? ` · ${statusLine(v)}` : ''}${v.pinned ? ' · pinned' : ''}`,
    v.result ? `Result: ${v.result}` : '',
    `Added: ${v.created}`,
    v.branch ? `Branch: ${v.branch}` : '',
    v.base ? `Merges into: ${v.base}` : '',
    v.mergeStopped ? `Merge stopped: ${v.mergeStopped}` : '',
    v.desc ? `\n${v.desc}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
