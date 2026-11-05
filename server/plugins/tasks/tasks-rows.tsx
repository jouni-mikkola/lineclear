import clsx from 'clsx'
import { useEffect, useState, type ReactNode } from 'react'
import {
  archivedIn,
  archiveTask,
  closeTask,
  deleteTask,
  namesFor,
  getState,
  openTask,
  openSplit,
  panesHere,
  splitClick,
  pauseTask,
  pinTask,
  placeOf,
  setFilter,
  setUI,
  useSnap,
  useUI,
  type ListView,
  type TaskGroup,
} from '@client/kernel.ts'
import { ListChips } from '@client/chips.tsx'
import {
  ArchiveIcon,
  BackIcon,
  CheckCircleIcon,
  DeleteIcon,
  DownIcon,
  Empty,
  FilterBox,
  ic,
  IconButton,
  List,
  MenuItem,
  MenuSeparator,
  Meta,
  NextIcon,
  PauseIcon,
  PinTaskIcon,
  Primary,
  rowClass,
  RowText,
  SplitIcon,
  taskLine,
  TaskDot,
  UnarchiveIcon,
  UnpinIcon,
} from '@client/ui.tsx'
import type { Snapshot, Task } from '@shared/types.ts'
import { and, Dialog, RowMenu, RowMenuButton, useRowMenu, type RowMenuState } from '@client/rowmenu.tsx'
import { RestartItem } from '@client/restart.tsx'

/* ---------- archiving a working task, and deleting any, ask first ---------- */

type Confirming = { t: Task; kind: 'archive' | 'delete' } | { t: Task; kind: 'close'; held: string[]; error?: string }
let confirming: Confirming | null = null
function setConfirming(value: typeof confirming): void {
  confirming = value
}

const confirmListeners = new Set<() => void>()
function setConfirm(c: Confirming | null) {
  setConfirming(c)
  confirmListeners.forEach((f) => f())
}

/** Mark done: at once when nothing would be left unmerged; else it asks first (and says why when it can't be done) */
async function markDone(t: Task) {
  const r = await closeTask(t).catch((e: Error) => ({ ok: false, error: e.message, held: undefined }))
  if (r.held?.length) setConfirm({ t, kind: 'close', held: r.held })
  else if (r.ok === false) setConfirm({ t, kind: 'close', held: [], error: r.error || 'It could not be marked done.' })
}

/**
 * The row's menu: Pin or Unpin (not for an archived task), Pause (a working task), Restart agent (an open one), Mark done (one not done yet; it asks
 * first when work would stay unmerged), Archive (a working task asks first: its agent stops) or Unarchive, then
 * Delete, which always asks first.
 */
function TaskMenu({ t, menu }: { t: Task; menu: RowMenuState }) {
  const then = (f: () => unknown) => () => {
    menu.close()
    f()
  }
  const desktop = useUI((u) => u.device === 'desktop')
  return (
    <RowMenu menu={menu} label={t.id}>
      {desktop ? (
        <>
          <MenuItem icon={<SplitIcon className={ic} />} onClick={then(() => openSplit({ kind: 'task', id: t.id }))}>
            Open in split view
          </MenuItem>
          <MenuSeparator />
        </>
      ) : null}
      {t.archived ? null : t.pinned ? (
        <MenuItem icon={<UnpinIcon className={ic} />} onClick={then(() => pinTask(t, false).catch(() => undefined))}>
          Unpin
        </MenuItem>
      ) : (
        <MenuItem icon={<PinTaskIcon className={ic} />} onClick={then(() => pinTask(t, true).catch(() => undefined))}>
          Pin
        </MenuItem>
      )}
      {t.status === 'work' && !t.archived ? (
        <MenuItem icon={<PauseIcon className={ic} />} onClick={then(() => pauseTask(t).catch(() => undefined))}>
          Pause
        </MenuItem>
      ) : null}
      {t.status !== 'done' && !t.archived ? <RestartItem chat={t.agent?.chat ?? `${t.id}/Agent`} name={t.id} onPick={menu.close} /> : null}
      {t.status !== 'done' ? (
        <MenuItem icon={<CheckCircleIcon className={ic} />} onClick={then(() => markDone(t))}>
          Mark done
        </MenuItem>
      ) : null}
      {t.archived ? (
        <MenuItem icon={<UnarchiveIcon className={ic} />} onClick={then(() => archiveTask(t, false).catch(() => undefined))}>
          Unarchive
        </MenuItem>
      ) : (
        <MenuItem
          icon={<ArchiveIcon className={ic} />}
          onClick={then(() => (t.status === 'work' ? setConfirm({ t, kind: 'archive' }) : archiveTask(t, true).catch(() => undefined)))}
        >
          Archive
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem icon={<DeleteIcon className={ic} />} className="text-need-fg" onClick={then(() => setConfirm({ t, kind: 'delete' }))}>
        Delete…
      </MenuItem>
    </RowMenu>
  )
}

/**
 * A task, with one line under its title (taskLine). Working, its pie fills with the % done its agent reported and the minutes
 * left sit small under it. Every row shows its age (how long it has been as it is) at its end, like the rows around it;
 * waiting on you, its frozen status line stays in its chat's header.
 */
export function TaskRow({ t, ix, where }: { t: Task; ix: number; where?: string[] }) {
  // the open task, or the focused pane's in split view
  const sel = useUI((u) => u.task === t.id || (panesHere(u)[u.split.pane]?.kind === 'task' && panesHere(u)[u.split.pane].id === t.id))
  const kb = useUI((u) => u.kb && !u.task && u.cur === ix)
  const sub = taskLine(t, where)
  // archived: a quiet ring, or a done task's check; the status it was put away with stays in its chat
  const dot = t.archived ? (t.status === 'done' ? 'done' : 'idle') : t.status
  const menu = useRowMenu()
  // while its ⋯ shows, the age gives it its place
  const shy = menu.open ? 'invisible' : '[@media(hover:hover)]:group-hover:invisible [@media(hover:hover)]:group-has-focus-visible:invisible'
  return (
    <li
      data-flip={t.id}
      className={clsx(rowClass(sel, kb), 'group p-0! select-none [-webkit-touch-callout:none]', menu.open && !sel && 'bg-hover')}
      {...menu.press}
    >
      {/* the whole row is one button (it opens the task); its ⋯ sits over its end, a button of its own */}
      <button
        type="button"
        aria-current={sel || undefined}
        // with ⌘ (Ctrl off a Mac), beside the focused pane in split view
        onClick={(e) => !menu.held() && (splitClick(e) ? openSplit({ kind: 'task', id: t.id }) : openTask(t.id))}
        className={clsx(
          'flex min-h-[inherit] min-w-0 flex-1 cursor-pointer gap-2 rounded-[inherit] px-2 text-left outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)] phone:px-3',
          sub ? 'items-start py-1.5 [&>.dot]:mt-[3px] phone:[&>.dot]:mt-1' : 'items-center',
        )}
      >
        <TaskDot s={dot} w={t.archived ? undefined : t.report} />
        <RowText sub={sub}>
          <span className="text-fg3">{t.id}</span> {t.name}
        </RowText>
        <Meta className={shy}>{t.age}</Meta>
      </button>
      <RowMenuButton
        menu={menu}
        label="More for this task"
        className={clsx('absolute right-1 z-1 phone:right-1.5', sub ? 'top-1.5 phone:top-2.5' : 'top-1/2 -translate-y-1/2')}
      />
      {menu.open ? <TaskMenu t={t} menu={menu} /> : null}
    </li>
  )
}

const cancel = () => setConfirm(null)

/** "Mark SHE-12 done?" when it holds work main lacks: that stays in its worktree and branch, but nothing is merged.
 *  failed: it could not be marked done, and this says why */
function ConfirmClose({ t, held, failed }: { t: Task; held: string[]; failed?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(failed ?? null)
  const go = async () => {
    setBusy(true)
    const r = await closeTask(t, true).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (r.ok === false) return setError(r.error || 'It could not be marked done.')
    setConfirm(null)
  }
  return (
    <Dialog
      onCancel={cancel}
      title={failed ? `${t.id} wasn’t marked done` : `Mark ${t.id} done?`}
      safe={!held.length}
      cancel={held.length ? 'Cancel' : 'OK'}
      buttons={
        held.length ? (
          <Primary autoFocus disabled={busy} onClick={go}>
            {busy ? 'Marking done…' : 'Mark done'}
          </Primary>
        ) : null
      }
    >
      {held.length ? <p>It holds {and(held)}. Nothing is merged; its worktree and branch keep that work.</p> : null}
      {error ? <p className="mt-1.5 text-need-fg">{error}</p> : null}
    </Dialog>
  )
}

/**
 * "Delete SHE-12?": it goes for good, with its agent, worktree, branch and chat. A task that holds work the branch
 * hasn't landed (or uncommitted changes) is refused first; then it says what would be lost and offers to delete anyway.
 */
function ConfirmDelete({ t }: { t: Task }) {
  const [busy, setBusy] = useState(false)
  const [held, setHeld] = useState<string[] | null>(null)
  // its agent was stopped while it was looked at again: it waits for a message to go on
  const [stopped, setStopped] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    setError(null)
    const r = await deleteTask(t, !!held).catch((e: Error) => ({ ok: false, error: e.message, held: undefined, stopped: false }))
    setBusy(false)
    if (r.held?.length) {
      setStopped(!!r.stopped)
      return setHeld(r.held)
    }
    if (r.ok === false) return setError(r.error || 'It could not be deleted.')
    setConfirm(null)
    // its chat was open: it is gone, so back to the place
    if (getState().ui.task === t.id) setUI({ task: null })
  }
  return (
    <Dialog
      onCancel={cancel}
      safe
      title={`Delete ${t.id}?`}
      buttons={
        <Primary className="bg-need-fg! text-white! dark:text-black!" disabled={busy} onClick={go}>
          {busy ? 'Deleting…' : held ? 'Delete anyway' : 'Delete'}
        </Primary>
      }
    >
      {held ? (
        <p>
          It holds {and(held)}.{stopped ? ' Its agent was stopped; writing to it starts it again.' : ''} Deleting it anyway loses that work for good.
        </p>
      ) : (
        <p>Its agent, worktree, branch and chat go for good. This can’t be undone.</p>
      )}
      {error ? <p className="mt-1.5 text-need-fg">{error}</p> : null}
    </Dialog>
  )
}

/** "Archive SHE-12?" for a task at work */
function ConfirmBox({ t }: { t: Task }) {
  const working = t.status === 'work'
  return (
    <Dialog
      onCancel={cancel}
      title={`Archive ${t.id}?`}
      buttons={
        <Primary
          autoFocus
          onClick={() => {
            setConfirm(null)
            archiveTask(t, true).catch(() => undefined)
          }}
        >
          {working ? 'Stop and archive' : 'Archive'}
        </Primary>
      }
    >
      <p>{working ? 'Its agent is working. Archiving stops it first; its' : 'Its agent stopped working. Its'} work stays, and writing to it starts it again.</p>
    </Dialog>
  )
}

/** "Archive SHE-12?" (its agent is at work, and archiving stops it first) or "Delete SHE-12?" */
export function ConfirmArchive() {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((n) => n + 1)
    confirmListeners.add(f)
    return () => void confirmListeners.delete(f)
  }, [])
  const snap = useSnap()
  // the task as it is now: it may have stopped working while this was up
  const c = confirming
  const t = c && snap ? (snap.tasks.find((x) => x.id === c.t.id) ?? c.t) : c?.t
  if (!c || !t) return null
  // a new question each time, its own state fresh
  if (c.kind === 'close') return <ConfirmClose key={`c:${t.id}`} t={t} held={c.held} failed={c.error} />
  return c.kind === 'delete' ? <ConfirmDelete key={`d:${t.id}`} t={t} /> : <ConfirmBox key={`a:${t.id}`} t={t} />
}

/** where a task is, as its row says it: its machine and space, each only where neither the view nor its group's
 *  heading says it ("vm-str · gtm") */
export function whereOf(snap: Snapshot, t: Task, names: TaskGroup['names']) {
  const p = placeOf(snap, t.place)
  const m = names.machine ? snap.machines?.find((x) => x.machine === p.machine) : undefined
  return [m?.name, names.project ? p.name : undefined].filter((x): x is string => !!x)
}

/** what to ask for a task where none is: the one space's coordinator, else any */
export function noTasks(snap: Snapshot, list: ListView) {
  const one = list.level === 2 ? snap.places.find((p) => p.id === list.chips[0]) : undefined
  return one ? `No tasks yet. Ask ${one.name} to add one.` : 'No tasks yet. Ask a coordinator to add one.'
}

/** A list's archived tasks, the latest archived first: each opens its chat; its ⋯ (or a held finger) brings it back */
export function ArchivedList({ list: view }: { list: ListView }) {
  const snap = useSnap()!
  const list = archivedIn(snap, view)
  return (
    <div>
      {/* one header row, as a group's: Back to the tasks, its name and how many */}
      <div className="flex min-h-9 items-center gap-1 pt-2 pr-4 pl-1.5 text-[0.75rem] font-medium text-fg3 phone:pt-2.5 phone:pr-5 phone:pl-2 phone:text-[0.875rem]">
        <IconButton label="Back to tasks" onClick={() => setUI({ archived: null, cur: 0 })}>
          <BackIcon className={ic} />
        </IconButton>
        <h3 className="min-w-0 flex-1 truncate">Archived</h3>
        {list.length ? <span className="shrink-0 tabular-nums">{list.length}</span> : null}
      </div>
      {list.length ? (
        <List>
          {list.map((t, i) => (
            <TaskRow key={t.id} t={t} ix={i} where={whereOf(snap, t, namesFor(view.level))} />
          ))}
        </List>
      ) : (
        <Empty className="pt-0.5 text-fg3">No archived tasks. Archive a task from its menu to keep it here.</Empty>
      )}
      <Empty className="pt-3 text-fg3">Archived tasks keep their chat and summary. Search finds them too.</Empty>
    </div>
  )
}

/** Filter tasks: by id, title, status line or summary, as you type; ↑ ↓ pick one of what is left and Enter opens it */
export function TaskFilter({ listKey, order }: { listKey: string; order: Task[] }) {
  const value = useUI((u) => u.filter[`${listKey}|tasks`] ?? '')
  const cur = useUI((u) => (u.kb ? u.cur : -1))
  // its key, where there is a keyboard
  const keys = useUI((u) => u.device === 'desktop' || u.kb)
  return (
    <FilterBox
      label="Filter tasks"
      hint={keys ? 'F' : undefined}
      value={value}
      onChange={(q) => setFilter(listKey, 'tasks', q)}
      onKey={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          setUI({ kb: true, cur: Math.max(0, Math.min(order.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1))) })
        } else if (e.key === 'Enter' && order[Math.max(0, cur)]) {
          e.preventDefault()
          openTask(order[Math.max(0, cur)].id)
        }
      }}
    >
      <ListChips />
    </FilterBox>
  )
}

/** a heading's fold: shut or open, and what a tap does (all: Alt/Option held, its siblings go the same way) */
export type Fold = { shut: boolean; toggle: (all: boolean) => void }

/**
 * A heading that folds what is under it away, as the sidebar's tree does: the whole heading is the button, the
 * sidebar's chevron where the rows' dots are, its count at the end, shut or open. Alt/Option-click takes its siblings
 * with it. Without a fold (filtering: every match shows) it is just the heading, in the same place.
 */
function FoldHeading({
  name,
  fold,
  flip,
  className,
  children,
  count,
}: {
  name: string
  fold?: Fold
  flip?: string
  className?: string
  children: ReactNode
  count?: number
}) {
  const Icon = fold?.shut ? NextIcon : DownIcon
  const inner = (
    <>
      {fold ? (
        <Icon aria-hidden className={clsx(ic, '-mx-px text-fg3 group-hover/h:text-fg phone:mx-0')} />
      ) : (
        <span aria-hidden className={clsx(ic, '-mx-px phone:mx-0')} />
      )}
      {children}
      {count ? <span className="ml-auto shrink-0 text-[0.75rem] font-medium text-fg3 tabular-nums phone:text-[0.875rem]">{count}</span> : null}
    </>
  )
  const look = 'flex min-h-9 w-full items-center gap-2 rounded-row px-2 text-left phone:min-h-11 phone:px-3'
  return (
    <div data-flip={flip} data-heading={name} className={clsx('px-1.5 phone:px-2', className)}>
      {fold ? (
        <button
          type="button"
          aria-expanded={!fold.shut}
          onClick={(e) => fold.toggle(e.altKey)}
          className={clsx(
            look,
            'press group/h cursor-pointer outline-none select-none hover:bg-hover focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-focus)] coarse:min-h-11',
          )}
        >
          {inner}
        </button>
      ) : (
        <div className={look}>{inner}</div>
      )}
    </div>
  )
}

/** On All machines, a machine's name over its tasks or its spaces' groups: a step above their labels, a hairline
 *  between machines;
 *  folded shut, its groups go and its count stays. Filtering, it doesn't fold. */
export function MachineHeading({ name, first, count, fold }: { name: string; first: boolean; count: number; fold?: Fold }) {
  return (
    <FoldHeading name={name} fold={fold} flip={`machine:${name}`} count={count} className={clsx('pt-1.5', !first && 'mt-2 border-t border-line')}>
      <h3 className="min-w-0 truncate text-[0.8125rem] font-semibold text-fg2 phone:text-[0.9375rem]">{name}</h3>
    </FoldHeading>
  )
}

/** A group's label (Working, Done, a space): folds its tasks away, and its Show all with them */
export function GroupHeading({ label, note, count, flip, fold }: { label: string; note?: string; count: number; flip?: string; fold?: Fold }) {
  return (
    <FoldHeading name={label} fold={fold} flip={flip} count={count} className="pt-1">
      <span className="min-w-0 truncate text-[0.75rem] font-medium text-fg3 phone:text-[0.875rem]">
        {label}
        {/* by space on All machines, the machine it is on */}
        {note ? <span className="font-normal opacity-75"> · {note}</span> : null}
      </span>
    </FoldHeading>
  )
}

/** Under a group cut to its latest Done tasks, "Show all 96"; once they all show, "Show less": a quiet row, not a call to act */
export function DoneToggle({ more, onClick }: { more: number; onClick: () => void }) {
  return (
    <div className="px-1.5 phone:px-2">
      <button
        type="button"
        aria-expanded={!more}
        className="press flex min-h-8 items-center gap-1 rounded-full px-2.5 text-[0.75rem] font-medium text-fg3 hover:text-fg2 focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-focus)] focus-visible:outline-none coarse:min-h-11 phone:min-h-11 phone:px-3 phone:text-[0.875rem]"
        onClick={onClick}
      >
        {more ? `Show all ${more}` : 'Show less'}
        <DownIcon aria-hidden className={clsx('size-3.5 shrink-0', !more && 'rotate-180')} />
      </button>
    </div>
  )
}
