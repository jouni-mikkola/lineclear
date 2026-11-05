import clsx from 'clsx'
import { Fragment, useRef, useState } from 'react'
import {
  act,
  archivedIn,
  filteredGroups,
  filterOf,
  getState,
  groupChoices,
  groupFor,
  listView,
  openTask,
  placeOf,
  registry,
  setChips,
  setGroup,
  setUI,
  toggleAllDone,
  toggleShut,
  shownGroups,
  taskOf,
  useSnap,
  useStore,
  useUI,
  type GroupBy,
  type ListView,
} from '@client/kernel.ts'
import { ListChips } from '@client/chips.tsx'
import {
  ArchivedIcon,
  CheckIcon,
  ClockIcon,
  DownIcon,
  Empty,
  ic,
  IconButton,
  LinkButton,
  List,
  Menu,
  MenuItem,
  MenuLabel,
  Meta,
  MoreIcon,
  NextIcon,
  RoundButton,
  Row,
  rowClass,
  RowText,
} from '@client/ui.tsx'
import { clockWithDay } from '@shared/time.ts'
import type { Automation, Place } from '@shared/types.ts'
import { useFlip } from '@client/motion.ts'
import { ArchivedList, noTasks, TaskFilter, MachineHeading, type Fold, GroupHeading, TaskRow, whereOf, DoneToggle } from './tasks-rows.tsx'

/** The lists' tasks: what their chips hold (placeId, the place picked, is for plugins of old) */
export function TaskList(_: { placeId: string }) {
  const snap = useSnap()!
  const view = useStore((s) => listView(s.ui, snap))
  const key = view.key
  const chosen = useUI((u) => u.groups)
  const allDone = useUI((u) => u.allDone)
  const shut = useUI((u) => u.shut)
  const archived = useUI((u) => u.archived === key)
  const q = useUI((u) => filterOf(u, view.search, 'tasks'))
  // the footer's place: the one space shown, else the place picked
  const place = placeOf(snap, view.level === 2 ? view.chips[0] : getState().ui.place)
  const by = groupFor(chosen, view.level)
  // a task moving to another group glides there; a new one fades in; what a filter, Show all, a fold or a chip leaves
  // just shows
  const list = useRef<HTMLDivElement>(null)
  useFlip(list, `${key}|${by}|${q}|${allDone.join()}|${shut.join()}`)
  if (archived) return <ArchivedList list={view} />
  // filtering, Done and archived tasks are in it too, each group whole and open, folded shut or not
  const groups = q
    ? filteredGroups(snap, view, q, { groups: chosen }).map((g) => ({ ...g, count: g.tasks.length, more: 0, less: false, shut: false }))
    : shownGroups(snap, view, { groups: chosen, allDone, shut })
  // what the keyboard walks: the rows on screen
  const order = groups.flatMap((g) => g.tasks)
  const footer = q ? null : registry.tasksFooter.map((F, i) => <F key={i} place={place} list={view} />)
  if (!groups.length && !q && !archivedIn(snap, view).length)
    return (
      <>
        <ListChips alone />
        <Empty>{view.attention ? 'No tasks need you or are ready.' : noTasks(snap, view)}</Empty>
        {view.attention ? <LinkButton onClick={() => setChips(view.chips)}>Show all tasks</LinkButton> : null}
        {footer}
      </>
    )
  const machines = [...new Set(groups.flatMap((g) => (g.machine ? [g.machine.id] : [])))]
  const machineShut = (id: string) => !q && shut.includes(`${key}|m:${id}`)
  return (
    <>
      <TaskFilter listKey={view.search} order={order} />
      {view.attention && !q ? (
        <div className="flex items-center justify-between gap-2 px-3 pt-2 text-[0.8125rem] text-fg2 phone:px-4 phone:text-[0.9375rem]">
          <span>Actionable · all machines</span>
          <LinkButton onClick={() => setChips(view.chips)}>Show all tasks</LinkButton>
        </div>
      ) : null}
      {/* one flat run of keyed parts: a group showing or going never makes the ones after it start over; only the
          rows and what sits between them glide (data-flip), never what holds them, so no move adds to another */}
      <div ref={list} className="relative">
        {groups.flatMap((g, i) => {
          // All machines: a machine's name over its groups, once, with how many tasks they hold
          const m = g.machine
          const head =
            m && m.id !== groups[i - 1]?.machine?.id ? (
              <MachineHeading
                key={`machine:${m.id}`}
                name={m.name}
                first={!i}
                count={groups.filter((x) => x.machine?.id === m.id).reduce((n, x) => n + x.count, 0)}
                fold={
                  q
                    ? undefined
                    : {
                        shut: machineShut(m.id),
                        toggle: (all) => toggleShut(key, `m:${m.id}`, all ? machines.filter((x) => x !== m.id).map((x) => `m:${x}`) : []),
                      }
                }
              />
            ) : null
          // a machine folded shut shows its name alone
          if (m && machineShut(m.id)) return [head]
          // its siblings: the groups under the same machine (or under none)
          const siblings = () => groups.filter((x) => x !== g && x.machine?.id === m?.id).map((x) => x.key)
          const fold: Fold | undefined = q ? undefined : { shut: g.shut, toggle: (all) => toggleShut(key, g.key, all ? siblings() : []) }
          return [
            head,
            <div key={g.key}>
              {g.kind === 'machine' ? (
                <MachineHeading name={g.label} first={!i} count={g.count} fold={fold} />
              ) : (
                <GroupHeading label={g.label} note={g.note} count={g.count} flip={`group:${g.key}`} fold={fold} />
              )}
              {g.shut ? null : g.tasks.length ? (
                <List>
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} t={t} ix={order.indexOf(t)} where={whereOf(snap, t, g.names)} />
                  ))}
                </List>
              ) : (
                // only To do shows empty; with no tasks at all it says how one comes
                <div data-flip={`empty:${g.key}`}>
                  <Empty className="pt-0.5 text-fg3">{order.length ? 'No tasks to do yet. Ask a coordinator to add one.' : noTasks(snap, view)}</Empty>
                </div>
              )}
              {g.more || g.less ? (
                <div data-flip={`more:${g.key}`}>
                  <DoneToggle more={g.more} onClick={() => toggleAllDone(key, g.key)} />
                </div>
              ) : null}
            </div>,
          ]
        })}
        {q && !groups.length ? <Empty className="pt-3 text-fg3">No tasks match “{q}”. Try another search or change the filters.</Empty> : null}
        {footer}
      </div>
    </>
  )
}

/** At the very bottom of a list's tasks, once it has archived ones: "Archived · 12", opening them */
export function ArchivedLink({ list }: { place: Place; list?: ListView }) {
  const snap = useSnap()!
  const n = list ? archivedIn(snap, list).length : 0
  if (!n) return null
  return (
    // a button, not a list row: it opens a view, it is not a task
    <div data-flip="archived" className="mt-2 border-t border-line px-1.5 pt-1.5 phone:px-2">
      <button type="button" className={clsx(rowClass(), 'w-full text-left')} onClick={() => setUI({ archived: list!.key, cur: 0 })}>
        <span className="flex min-w-0 flex-1 items-center gap-2 text-fg2">
          <ArchivedIcon aria-hidden className={`${ic} text-fg3`} />
          <span className="truncate">Archived</span>
        </span>
        <Meta>{n}</Meta>
        <NextIcon aria-hidden className={`${ic} text-fg3`} />
      </button>
    </div>
  )
}

const GROUP_WORDS: Record<GroupBy, string> = { status: 'Status', machine: 'Machine', project: 'Space', 'machine-project': 'Machine › Space' }

/** The Tasks header's ⋯: group a machine's tasks by status or space; more machines' also by machine, or by machine
 *  and then space (place, the place picked, is for plugins of old) */
export function TasksMenu(_: { place: Place }) {
  const snap = useSnap()!
  const view = useStore((s) => listView(s.ui, snap))
  const level = view.level
  const chosen = useUI((u) => u.groups)
  const by = view.attention ? 'project' : groupFor(chosen, level)
  const phone = useUI((u) => u.device === 'phone')
  const [open, setOpen] = useState(false)
  const choices = groupChoices(level)
  if (choices.length < 2) return null
  const B = phone ? RoundButton : IconButton
  return (
    <div className="relative">
      <B
        label="Group tasks"
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx('rounded-full!', phone ? 'aria-expanded:bg-line2' : 'aria-expanded:bg-hover')}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon className={ic} />
      </B>
      {open ? (
        <Menu label="Group tasks" onClose={() => setOpen(false)} className="absolute top-full right-0 z-21 mt-1.5 max-w-[calc(100vw-24px)] origin-top-right">
          <div role="group" aria-label="Group by">
            <MenuLabel>Group by</MenuLabel>
            {choices.map((c) => (
              <MenuItem
                key={c}
                role="menuitemradio"
                aria-checked={by === c}
                icon={by === c ? <CheckIcon className={ic} /> : null}
                onClick={() => {
                  setOpen(false)
                  setGroup(level, c)
                }}
              >
                {GROUP_WORDS[c]}
              </MenuItem>
            ))}
          </div>
        </Menu>
      ) : null}
    </div>
  )
}

/** a task's pull request, small in its chat's header: a tap opens it on GitHub */
export function PrLink({ chatKey }: { chatKey: string }) {
  const snap = useSnap()!
  const ui = useUI()
  const pr = chatKey.includes('/') ? taskOf(snap, chatKey.split('/')[0])?.pr : undefined
  if (!pr) return null
  const phone = ui.device === 'phone'
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      data-pr={pr.number}
      className={clsx(
        'press-dim inline-flex shrink-0 items-center rounded-full font-medium whitespace-nowrap text-fg2 tabular-nums',
        phone ? 'h-11 bg-bubble px-3.5 text-[0.9375rem]' : 'h-7 px-2.5 text-[0.8125rem] shadow-[inset_0_0_0_1px_var(--line2)] hover:bg-hover',
      )}
    >
      {/* a phone's header has room for the number alone */}
      {phone ? `#${pr.number}` : `PR #${pr.number}`}
    </a>
  )
}

const small = 'text-[0.8125rem] phone:text-[0.9375rem]'

/** An open automation: when (its trigger in words) and its next runs, the task it adds in full, its last runs, and what you can do with it; lined up with its
 *  name */
function AutomationDetail({ id, place, a }: { id: string; place: Place; a: Automation }) {
  const [error, setError] = useState('')
  const run = async (op: 'run' | 'pause' | 'resume' | 'remove') => {
    const r = (await act({ type: 'automation', place: place.id, op, name: a.name })) as { ok?: boolean; error?: string } | undefined
    setError(r?.ok === false ? (r.error ?? 'Refused.') : '')
  }
  return (
    <li id={id} className="pr-2 pb-2 pl-8 phone:pr-3 phone:pl-9">
      <dl className={clsx('grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1', small)}>
        <dt className="font-medium text-fg">When</dt>
        <dd className="text-fg2">
          {a.when}
          {a.on ? '' : ' (paused)'}
        </dd>
        {a.next.length ? (
          <>
            <dt className="font-medium text-fg">Next</dt>
            <dd className="text-fg2 tabular-nums">{a.next.join(' · ')}</dd>
          </>
        ) : null}
        <dt className="font-medium text-fg">Task</dt>
        <dd className="text-pretty break-words text-fg2">{a.what}</dd>
        {a.brief ? (
          <>
            <dt className="font-medium text-fg">Brief</dt>
            <dd className="text-pretty break-words whitespace-pre-wrap text-fg2">{a.brief}</dd>
          </>
        ) : null}
        <dt className="font-medium text-fg">Last runs</dt>
        <dd className="text-fg2">
          {a.runs.length
            ? a.runs.slice(0, 3).map((r) => (
                <div key={r.at}>
                  {clockWithDay(r.at)} ·{' '}
                  {r.task ? (
                    <button type="button" className="press-dim text-focus hover:underline" onClick={() => openTask(r.task!)}>
                      {r.task}
                    </button>
                  ) : (
                    <span className="text-need">failed: {r.error}</span>
                  )}
                </div>
              ))
            : 'Not run yet'}
        </dd>
      </dl>
      {error ? <div className={clsx('mt-1 text-need', small)}>{error}</div> : null}
      <div className={clsx('mt-1.5 flex flex-wrap gap-x-4 gap-y-1 phone:mt-2', small)}>
        <LinkButton onClick={() => run('run')}>Run now</LinkButton>
        <LinkButton onClick={() => run(a.on ? 'pause' : 'resume')}>{a.on ? 'Pause' : 'Resume'}</LinkButton>
        <LinkButton onClick={() => run('remove')}>Remove</LinkButton>
      </div>
    </li>
  )
}

function SpaceAutomations({ place, note }: { place: Place; note?: string }) {
  const snap = useSnap()!
  const [open, setOpen] = useState<string | null>(null)
  // it folds away like the task groups above it
  const shut = useUI((u) => u.shut.includes(`${place.id}|automations`))
  const list = snap.automations[place.id] ?? []
  if (!list.length) return null
  return (
    <div data-flip={note ? `automations:${place.id}` : 'automations'}>
      <GroupHeading label="Automations" note={note} count={list.length} fold={{ shut, toggle: () => toggleShut(place.id, 'automations') }} />
      {shut ? null : (
        <List>
          {list.map((a) => {
            const on = open === a.name
            const id = `automation-${place.id}-${a.name}`.replace(/[^\w-]/g, '-')
            return (
              <Fragment key={a.name}>
                <Row two aria-expanded={on} aria-controls={id} onActivate={() => setOpen(on ? null : a.name)}>
                  {/* a clock, not a box: an automation runs on its own, there is nothing to tick; as wide as a status dot */}
                  <ClockIcon className={clsx(ic, '-mx-px h-lh text-fg3 phone:mx-0', !a.on && 'opacity-50')} />
                  <RowText sub={`${a.on ? '' : 'Paused · '}${a.when}`}>{a.name}</RowText>
                  <DownIcon aria-hidden className={clsx(ic, 'h-lh text-fg3', on && 'rotate-180')} />
                </Row>
                {on ? <AutomationDetail id={id} place={place} a={a} /> : null}
              </Fragment>
            )
          })}
        </List>
      )}
    </div>
  )
}

/**
 * A space's automations, at the bottom once it has one (everything, every space's): its name, then when it runs.
 * A tap shows the task it adds and its last runs, and lets you run it now, pause or remove it. Each run adds a new task with a
 * fresh agent. Only agents add or change them, through the shepherdr command, when asked in the chat: none, no section.
 */
export function Automations({ place, list }: { place: Place; list?: ListView }) {
  const snap = useSnap()!
  // each space the chips name has its own; everything (no chips), every space's, each with its name; a machine's, none
  const all = !!list && !list.chips.length
  const spaces = !list ? [place] : all ? snap.places : list.chips.flatMap((c) => snap.places.filter((p) => p.id === c))
  return spaces.map((p) => <SpaceAutomations key={p.id} place={p} note={all || spaces.length > 1 ? p.name : undefined} />)
}
